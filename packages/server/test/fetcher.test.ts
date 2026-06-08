import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFetcher } from '../src/fetcher.js';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createFetcher', () => {
  it('resolves a GET with parsed JSON data and status', async () => {
    stubFetch(async () => json({ ok: true }));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    const res = await fetcher({ url: '/health' });
    expect(res).toEqual({ data: { ok: true }, status: 200 });
  });

  it('prefixes the baseUrl and strips a trailing slash', async () => {
    const mock = stubFetch(async () => json({}));
    const fetcher = createFetcher({ baseUrl: 'https://api.test/', logger: silentLogger });
    await fetcher({ url: '/goals/1' });
    expect(mock.mock.calls[0]![0]).toBe('https://api.test/goals/1');
  });

  it('sanitizes hop-by-hop, sec-*, and forbidden headers while keeping authorization', async () => {
    const mock = stubFetch(async () => json({}));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    await fetcher({
      url: '/x',
      headers: {
        authorization: 'Bearer keep-me',
        host: 'drop',
        connection: 'drop',
        'accept-encoding': 'gzip',
        'content-length': '5',
        'sec-ch-ua': 'drop',
        'sec-fetch-site': 'drop',
        'x-keep': 'yes',
        empty: '   ',
      },
    });
    const sent = mock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(sent.authorization).toBe('Bearer keep-me');
    expect(sent['x-keep']).toBe('yes');
    expect(sent.host).toBeUndefined();
    expect(sent.connection).toBeUndefined();
    expect(sent['accept-encoding']).toBeUndefined();
    expect(sent['content-length']).toBeUndefined();
    expect(sent['sec-ch-ua']).toBeUndefined();
    expect(sent['sec-fetch-site']).toBeUndefined();
    expect(sent.empty).toBeUndefined();
  });

  it('adds Accept/Content-Type and serializes an object body on POST', async () => {
    const mock = stubFetch(async () => json({}));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    await fetcher({ url: '/x', method: 'POST', body: { a: 1 } });
    const init = mock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('passes a string body through verbatim', async () => {
    const mock = stubFetch(async () => json({}));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    await fetcher({ url: '/x', method: 'PUT', body: 'raw-string' });
    expect(mock.mock.calls[0]![1]!.body).toBe('raw-string');
  });

  it('does not set a body or content headers on GET', async () => {
    const mock = stubFetch(async () => json({}));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    await fetcher({ url: '/x', method: 'GET' });
    const init = mock.mock.calls[0]![1]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('retries on 5xx and succeeds on a later attempt', async () => {
    const responses = [json({ err: 'down' }, 503), json({ ok: true }, 200)];
    let call = 0;
    const mock = stubFetch(async () => responses[call++]!);
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    const res = await fetcher({ url: '/x' });
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx and throws the upstream message', async () => {
    const mock = stubFetch(async () => json({ message: 'bad input' }, 400));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', logger: silentLogger });
    await expect(fetcher({ url: '/x' })).rejects.toMatchObject({
      status: 400,
      message: 'bad input',
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on persistent 5xx and throws with the upstream status', async () => {
    const mock = stubFetch(async () => json({ message: 'still down' }, 503));
    const fetcher = createFetcher({ baseUrl: 'https://api.test', retries: 1, logger: silentLogger });
    await expect(fetcher({ url: '/x' })).rejects.toMatchObject({
      status: 503,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('aborts on timeout and surfaces a 500 FetcherError', async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const fetcher = createFetcher({
      baseUrl: 'https://api.test',
      timeoutMs: 5,
      retries: 0,
      logger: silentLogger,
    });
    await expect(fetcher({ url: '/slow' })).rejects.toMatchObject({
      status: 500,
    });
  });
});
