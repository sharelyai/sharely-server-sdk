import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Handler } from '@sharelyai/protocol';

import { createSharelyServer, type CreateSharelyServerOptions } from '../src/createServer.js';

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** Mints a JWT-shaped token whose payload carries the given `exp` (seconds). */
const jwtWithExp = (expSeconds: number): string =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const echoHandler: Handler = async function* () {
  yield { type: 'message_start', role: 'assistant', model: 'echo' };
  yield { type: 'content_delta', delta: 'hi' };
  yield { type: 'content_end' };
  yield {
    type: 'message_end',
    finishReason: 'stop',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
};

interface RouterOpts {
  token?: string;
  validate?: unknown;
}

/** Routes the platform calls createServer/runHandler make to canned responses. */
const platformFetch = (opts: RouterOpts = {}) => {
  const token = opts.token ?? jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/generate-access-key-token')) return json({ token });
    if (u.endsWith('/api-authenticated')) return json(opts.validate ?? { id: 'user-1' });
    if (u.endsWith('/messages')) return json({ id: 'stored-1', role: 'assistant' });
    if (u.includes('/agent/threads/')) return json({ messages: [] });
    return json({});
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

const baseOpts = (
  over: Partial<CreateSharelyServerOptions> = {},
): CreateSharelyServerOptions => ({
  apiUrl: 'https://api.test',
  workspaceId: 'ws-1',
  workspaceApiKey: 'sk-sharely-test',
  handler: echoHandler,
  logger: silentLogger(),
  ...over,
});

const chat = (app: ReturnType<typeof createSharelyServer>) =>
  request(app).post('/agent/threads/thread-1/chat');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSharelyServer — construction guards', () => {
  it('throws when required options are missing', () => {
    expect(() => createSharelyServer({ ...baseOpts(), apiUrl: '' })).toThrow(/apiUrl/);
    expect(() => createSharelyServer({ ...baseOpts(), workspaceId: '' })).toThrow(/workspaceId/);
    expect(() => createSharelyServer({ ...baseOpts(), workspaceApiKey: '' })).toThrow(/workspaceApiKey/);
  });
});

describe('createSharelyServer — request validation', () => {
  it('rejects a missing message with 400', async () => {
    platformFetch();
    const app = createSharelyServer(baseOpts());
    const res = await chat(app).set('Authorization', 'Bearer good').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/message is required/);
  });

  it('rejects a missing Authorization header with 401', async () => {
    platformFetch();
    const app = createSharelyServer(baseOpts());
    const res = await chat(app).send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Authorization header is required/);
  });

  it('rejects a placeholder bearer token with 401', async () => {
    platformFetch();
    const app = createSharelyServer(baseOpts());
    const res = await chat(app).set('Authorization', 'Bearer null').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid bearer token/);
  });
});

describe('createSharelyServer — token validation', () => {
  it('rejects a token the platform does not recognize', async () => {
    platformFetch({ validate: {} }); // no id / temporalUserId
    const app = createSharelyServer(baseOpts());
    const res = await chat(app).set('Authorization', 'Bearer stale').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token rejected by platform/);
  });

  it('streams the handler output for a valid token', async () => {
    platformFetch({ validate: { id: 'user-1' } });
    const app = createSharelyServer(baseOpts());
    const res = await chat(app).set('Authorization', 'Bearer good').send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: message_start');
    expect(res.text).toContain('event: content_delta');
    expect(res.text).toContain('event: done');
  });
});

describe('createSharelyServer — handler crash does not leak (P1-4)', () => {
  it('returns a generic message and never surfaces the thrown detail', async () => {
    platformFetch({ validate: { id: 'user-1' } });
    const boom: Handler = async function* () {
      throw new Error('internal: secret connection string');
    };
    const app = createSharelyServer(baseOpts({ handler: boom }));
    const res = await chat(app).set('Authorization', 'Bearer good').send({ message: 'hi' });
    // The stream opens (headers sent) then emits a generic SSE error.
    expect(res.text).toContain('An internal error occurred');
    expect(res.text).not.toContain('secret connection string');
  });
});

describe('createSharelyServer — CORS default (P1-3)', () => {
  it('does NOT reflect an arbitrary origin when allowedOrigins is unset, and warns', async () => {
    platformFetch();
    const logger = silentLogger();
    const app = createSharelyServer(baseOpts({ logger }));
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('allowedOrigins'));
  });

  it('reflects an explicitly allowed origin', async () => {
    platformFetch();
    const logger = silentLogger();
    const app = createSharelyServer(baseOpts({ allowedOrigins: 'https://good.example', logger }));
    const res = await request(app).get('/health').set('Origin', 'https://good.example');
    expect(res.headers['access-control-allow-origin']).toBe('https://good.example');
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('allowedOrigins'));
  });
});

describe('createSharelyServer — JWT exchange caching & expiry (P1-2)', () => {
  const countExchanges = (mock: ReturnType<typeof platformFetch>) =>
    mock.mock.calls.filter(([u]) => String(u).includes('/generate-access-key-token')).length;

  it('reuses a long-lived exchanged JWT across requests', async () => {
    const mock = platformFetch({ token: jwtWithExp(Math.floor(Date.now() / 1000) + 3600) });
    const app = createSharelyServer(baseOpts({ validateIncomingToken: false }));
    await chat(app).set('Authorization', 'Bearer a').send({ message: 'one' });
    await chat(app).set('Authorization', 'Bearer a').send({ message: 'two' });
    expect(countExchanges(mock)).toBe(1);
  });

  it('re-exchanges a near-expiry JWT instead of serving a stale token (recovers without restart)', async () => {
    // exp within the skew window => treated as stale on the next request.
    const mock = platformFetch({ token: jwtWithExp(Math.floor(Date.now() / 1000) + 10) });
    const app = createSharelyServer(baseOpts({ validateIncomingToken: false }));
    await chat(app).set('Authorization', 'Bearer a').send({ message: 'one' });
    await chat(app).set('Authorization', 'Bearer a').send({ message: 'two' });
    expect(countExchanges(mock)).toBe(2);
  });

  it('invalidates and re-exchanges once when a Backplane call returns 401, then completes the stream', async () => {
    // A long-lived token (so the proactive exp refresh would NOT re-exchange),
    // but the first Backplane write is rejected — exercising the 401 fallback.
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    let messagePosts = 0;
    const mock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/generate-access-key-token')) return json({ token });
      if (u.endsWith('/messages')) {
        messagePosts += 1;
        return messagePosts === 1
          ? json({ message: 'token expired' }, 401)
          : json({ id: 'stored-1', role: 'assistant' });
      }
      if (u.includes('/agent/threads/')) return json({ messages: [] });
      return json({});
    });
    vi.stubGlobal('fetch', mock);

    const app = createSharelyServer(baseOpts({ validateIncomingToken: false }));
    const res = await chat(app).set('Authorization', 'Bearer a').send({ message: 'hi' });

    // The stream still completes end-to-end despite the mid-stream 401.
    expect(res.text).toContain('event: message_start');
    expect(res.text).toContain('event: done');
    // One re-exchange was forced by the 401 (initial exchange + one refresh).
    expect(countExchanges(mock)).toBe(2);
    // The rejected write was retried (1st = 401, 2nd = retry, 3rd = assistant).
    expect(messagePosts).toBeGreaterThanOrEqual(2);
  });
});

describe('createSharelyServer — proxy toggle (P1-5)', () => {
  it('404s unmatched routes when enableProxy is false', async () => {
    platformFetch();
    const app = createSharelyServer(baseOpts({ enableProxy: false }));
    const res = await request(app).get('/some/unmatched/path');
    expect(res.status).toBe(404);
  });
});
