import { describe, expect, it } from 'vitest';
import type { AgentEvent, Handler } from '@sharelyai/protocol';
import { makeTestInput, validateEventStream } from '@sharelyai/conformance';

import { fromVercelAI } from '../src/stream.js';
import type { VercelStreamPart, VercelStreamResult } from '../src/types.js';

const fullStream = (parts: VercelStreamPart[]): VercelStreamResult => ({
  fullStream: (async function* () {
    for (const p of parts) yield p;
  })(),
});

const collect = async (handler: Handler): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  for await (const e of handler(makeTestInput('go'))) events.push(e);
  return events;
};

const types = (events: AgentEvent[]) => events.map(e => e.type);

describe('fromVercelAI — golden conformance', () => {
  it('translates a plain text stream into a conformant AgentEvent stream', async () => {
    const handler = fromVercelAI(
      async () =>
        fullStream([
          { type: 'text-delta', textDelta: 'Hello ' },
          { type: 'text-delta', textDelta: 'world' },
          { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 } },
        ]),
      { model: 'gpt-test' },
    );
    const events = await collect(handler);
    expect(validateEventStream(events).ok).toBe(true);
    expect(types(events)).toEqual([
      'message_start',
      'content_delta',
      'content_delta',
      'content_end',
      'message_end',
    ]);
    const end = events.at(-1)!;
    expect(end).toMatchObject({
      type: 'message_end',
      finishReason: 'stop',
      tokenUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
    expect(events[0]).toMatchObject({ type: 'message_start', model: 'gpt-test' });
  });

  it('opens and closes a thinking step around reasoning parts', async () => {
    const handler = fromVercelAI(async () =>
      fullStream([
        { type: 'reasoning-delta', textDelta: 'pondering' },
        { type: 'text-delta', textDelta: 'answer' },
        { type: 'finish', finishReason: 'stop' },
      ]),
    );
    const events = await collect(handler);
    expect(validateEventStream(events).ok).toBe(true);
    expect(types(events)).toEqual([
      'message_start',
      'thinking_start',
      'thinking_delta',
      'thinking_end',
      'content_delta',
      'content_end',
      'message_end',
    ]);
  });

  it('translates a tool call + result + source into a conformant stream', async () => {
    const handler = fromVercelAI(async () =>
      fullStream([
        { type: 'tool-call', toolCallId: 'c1', toolName: 'search', args: { q: 'x' } },
        { type: 'tool-result', toolCallId: 'c1', result: { hits: 1 } },
        { type: 'source', source: { id: 's1', title: 'Doc', url: 'https://x' } },
        { type: 'finish', finishReason: 'stop' },
      ]),
    );
    const events = await collect(handler);
    expect(validateEventStream(events).ok).toBe(true);
    expect(types(events)).toContain('tool_call_start');
    expect(types(events)).toContain('tool_call_end');
    const sources = events.find(e => e.type === 'sources');
    expect(sources).toMatchObject({
      type: 'sources',
      sources: [{ id: 's1', type: 'semantic', title: 'Doc', url: 'https://x' }],
    });
  });

  it('emits an error event when the stream yields an error part', async () => {
    const handler = fromVercelAI(async () =>
      fullStream([
        { type: 'text-delta', textDelta: 'partial' },
        { type: 'error', error: new Error('model down') },
      ]),
    );
    const events = await collect(handler);
    expect(validateEventStream(events).ok).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'error', error: 'model down' });
  });

  it('emits message_start then error when produce() throws', async () => {
    const handler = fromVercelAI(async () => {
      throw new Error('could not create stream');
    });
    const events = await collect(handler);
    expect(validateEventStream(events).ok).toBe(true);
    expect(types(events)).toEqual(['message_start', 'error']);
    expect(events[1]).toEqual({ type: 'error', error: 'could not create stream' });
  });
});
