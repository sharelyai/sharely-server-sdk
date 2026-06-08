import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { AgentContext, AgentEvent, Handler } from '@sharelyai/protocol';
import type { SharelyAPIClient, StoreMessageInput } from '@sharelyai/api';

import { runHandler } from '../src/pipeline.js';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface ParsedEvent {
  type: string;
  data: Record<string, unknown>;
}

const makeRes = () => {
  const chunks: string[] = [];
  const res = {
    writableEnded: false,
    on: () => res,
    writeHead: () => res,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
  };
  const parse = (): ParsedEvent[] => {
    const out: ParsedEvent[] = [];
    for (const block of chunks.join('').split('\n\n')) {
      const lines = block.split('\n');
      const type = lines.find(l => l.startsWith('event: '))?.slice(7);
      const data = lines.find(l => l.startsWith('data: '))?.slice(6);
      if (type && data) out.push({ type, data: JSON.parse(data) });
    }
    return out;
  };
  return { res: res as unknown as Response, parse };
};

const makeContext = (): AgentContext =>
  ({
    workspaceId: 'ws',
    threadId: 'thread-1',
    authorization: 'Bearer x',
    api: {} as SharelyAPIClient,
    trace: {
      traceId: 'trace-1',
      messageId: 'msg-1',
      event: () => {},
      child() {
        return this;
      },
      end: () => {},
    },
  }) as AgentContext;

/** Mock api that records the persisted assistant message. */
const makeApi = (history: { role: string; content: string }[] = []) => {
  const created: StoreMessageInput[] = [];
  const create = vi.fn(async (_threadId: string, message: StoreMessageInput) => {
    created.push(message);
    return { ...message, id: message.id ?? 'generated-id' };
  });
  const api = {
    threads: {
      get: vi.fn(async () => ({ messages: history })),
      messages: { create },
    },
  } as unknown as SharelyAPIClient;
  return { api, created, create };
};

describe('runHandler — message assembly', () => {
  it('persists the user message, reduces events into the assistant message, and ends with done', async () => {
    const handler: Handler = async function* () {
      const events: AgentEvent[] = [
        { type: 'message_start', role: 'assistant', model: 'test-model' },
        { type: 'thinking_start', thinkingId: 't1', title: 'Reasoning' },
        { type: 'thinking_delta', thinkingId: 't1', delta: 'step one ' },
        { type: 'thinking_delta', thinkingId: 't1', delta: 'step two' },
        { type: 'thinking_end', thinkingId: 't1', status: 'completed', durationMs: 42 },
        { type: 'tool_call_start', toolCallId: 'c1', name: 'search', input: { q: 'x' } },
        { type: 'tool_call_end', toolCallId: 'c1', output: { hits: 2 }, durationMs: 7 },
        { type: 'sources', sources: [{ id: 's1', type: 'knowledge', title: 'A' }] },
        { type: 'sources', sources: [{ id: 's2', type: 'knowledge', title: 'B' }] },
        { type: 'metadata_update', metadata: { search: { hits: 2 } } },
        { type: 'content_delta', delta: 'Hello ' },
        { type: 'content_delta', delta: 'world.' },
        { type: 'content_end' },
        {
          type: 'message_end',
          finishReason: 'stop',
          tokenUsage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        },
      ];
      for (const e of events) yield e;
    };

    const { res, parse } = makeRes();
    const { api, created } = makeApi([{ role: 'user', content: 'hi' }]);

    await runHandler({
      handler,
      context: makeContext(),
      message: 'hi',
      res,
      api,
      logger: silentLogger,
    });

    // Two persistence calls: the inbound user message, then the assistant message.
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ role: 'user', content: 'hi' });

    const assistant = created[1]!;
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'Hello world.',
      model: 'test-model',
      finishReason: 'stop',
      tokenUsage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      metadata: { search: { hits: 2 } },
    });
    expect(assistant.thinkingSteps).toEqual([
      { id: 't1', title: 'Reasoning', content: 'step one step two', status: 'completed', durationMs: 42 },
    ]);
    expect(assistant.toolCalls).toEqual([
      { id: 'c1', name: 'search', input: { q: 'x' }, output: { hits: 2 }, status: 'completed', durationMs: 7 },
    ]);
    // sources aggregate across multiple sources events.
    expect(assistant.sources).toEqual([
      { id: 's1', type: 'knowledge', title: 'A' },
      { id: 's2', type: 'knowledge', title: 'B' },
    ]);

    const sse = parse();
    expect(sse[0]!.type).toBe('message_start');
    expect(sse.at(-1)!.type).toBe('done');
    // Every emitted event carries the wire envelope.
    expect(sse[0]!.data).toMatchObject({ threadId: 'thread-1', messageId: 'msg-1' });
    expect(res.writableEnded).toBe(true);
  });

  it('marks a failed tool call with status "error"', async () => {
    const handler: Handler = async function* () {
      yield { type: 'message_start', role: 'assistant', model: 'm' };
      yield { type: 'tool_call_start', toolCallId: 'c1', name: 'search', input: {} };
      yield { type: 'tool_call_end', toolCallId: 'c1', error: 'boom', durationMs: 1 };
      yield { type: 'content_end' };
      yield { type: 'message_end', finishReason: 'stop', tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    };
    const { res } = makeRes();
    const { api, created } = makeApi();
    await runHandler({ handler, context: makeContext(), message: 'x', res, api, logger: silentLogger });
    expect(created[1]!.toolCalls).toEqual([
      { id: 'c1', name: 'search', input: {}, output: undefined, error: 'boom', status: 'error', durationMs: 1 },
    ]);
  });
});

describe('runHandler — error handling (P1-4)', () => {
  it('emits a generic SSE error, does NOT leak the thrown message, and does not persist an assistant message', async () => {
    const handler: Handler = async function* () {
      yield { type: 'message_start', role: 'assistant', model: 'm' };
      throw new Error('secret upstream detail: db credentials leaked');
    };
    const { res, parse } = makeRes();
    const { api, created } = makeApi();

    await runHandler({ handler, context: makeContext(), message: 'x', res, api, logger: silentLogger });

    const sse = parse();
    const errorEvent = sse.find(e => e.type === 'error');
    expect(errorEvent?.data.error).toBe('An internal error occurred');
    // The raw thrown message must never reach the client.
    expect(JSON.stringify(sse)).not.toContain('secret upstream detail');
    // Only the user message was persisted — no assistant message on error.
    expect(created).toHaveLength(1);
    expect(created[0]!.role).toBe('user');
    // Stream still terminates cleanly.
    expect(sse.at(-1)!.type).toBe('done');
  });
});
