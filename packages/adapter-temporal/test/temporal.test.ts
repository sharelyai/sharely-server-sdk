import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Handler } from '@sharelyai/protocol';
import {
  checkGolden,
  makeTestInput,
  scenarios,
  validateEventStream,
} from '@sharelyai/conformance';

import { createAgentEventSink, emitAgentEvent } from '../src/sink.js';
import { pollingHandler } from '../src/poll.js';
import { fromTemporal } from '../src/temporal.js';
import type {
  AgentEventPage,
  AgentEventSource,
  TemporalClientLike,
  TemporalWorkflowHandle,
} from '../src/types.js';

const collect = async (handler: Handler, input = makeTestInput('go')): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  for await (const e of handler(input)) events.push(e);
  return events;
};

describe('createAgentEventSink', () => {
  it('buffers events and reports done once message_end is emitted', () => {
    const sink = createAgentEventSink();
    expect(sink.query(0)).toEqual({ events: [], done: false, cursor: 0 });

    emitAgentEvent(sink, { type: 'message_start', role: 'assistant', model: 'm' });
    const first = sink.query(0);
    expect(first.done).toBe(false);
    expect(first.cursor).toBe(1);

    emitAgentEvent(sink, {
      type: 'message_end',
      finishReason: 'stop',
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    // Polling from the last cursor returns only the new tail and marks done.
    expect(sink.query(1)).toMatchObject({ done: true });
    expect(sink.query(1).events.map(e => e.type)).toEqual(['message_end']);
  });

  it('marks done on an error event too', () => {
    const sink = createAgentEventSink();
    emitAgentEvent(sink, { type: 'error', error: 'boom' });
    expect(sink.query(0).done).toBe(true);
  });
});

/** Wraps a sink as an AgentEventSource for the polling handler. */
const sinkSource = (sink: ReturnType<typeof createAgentEventSink>): AgentEventSource => ({
  poll: async cursor => sink.query(cursor) as AgentEventPage,
  cancel: async () => {},
});

describe('pollingHandler', () => {
  it('drains a sink into a conformant golden stream', async () => {
    const scenario = scenarios.toolCall;
    const sink = createAgentEventSink();
    for (const e of scenario.golden) emitAgentEvent(sink, e);

    const handler = pollingHandler(() => sinkSource(sink), 0);
    const events = await collect(handler);

    expect(validateEventStream(events).ok).toBe(true);
    expect(checkGolden(events, scenario.golden).ok).toBe(true);
  });

  it('yields an error event when the source cannot be created', async () => {
    const handler = pollingHandler(() => {
      throw new Error('workflow start failed');
    });
    const events = await collect(handler);
    expect(events).toEqual([{ type: 'error', error: 'workflow start failed' }]);
    expect(validateEventStream(events).ok).toBe(true);
  });

  it('stops and cancels the source when the input signal is aborted', async () => {
    const cancel = vi.fn(async () => {});
    const controller = new AbortController();
    controller.abort();
    const source: AgentEventSource = {
      poll: async () => ({ events: [], done: false }),
      cancel,
    };
    const handler = pollingHandler(() => source);
    const events = await collect(handler, makeTestInput('go', { signal: controller.signal }));
    expect(events).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('fromTemporal', () => {
  it('starts a workflow and streams its queried events conformantly', async () => {
    const scenario = scenarios.thinking;
    const sink = createAgentEventSink();
    for (const e of scenario.golden) emitAgentEvent(sink, e);

    const handle = {
      query: vi.fn(async (_q: string, cursor: number) => sink.query(cursor)),
      cancel: vi.fn(async () => {}),
    } as unknown as TemporalWorkflowHandle;
    const start = vi.fn(async () => handle);
    const client = { start } as unknown as TemporalClientLike;

    const handler = fromTemporal({
      client,
      workflowType: 'agentWorkflow',
      taskQueue: 'agents',
      pollIntervalMs: 0,
    });
    const events = await collect(handler);

    expect(validateEventStream(events).ok).toBe(true);
    expect(checkGolden(events, scenario.golden).ok).toBe(true);
    // Default workflowId derives from threadId + trace.messageId.
    expect(client.start).toHaveBeenCalledWith(
      'agentWorkflow',
      expect.objectContaining({
        taskQueue: 'agents',
        workflowId: 'sharely-thread-conformance-msg-conformance',
      }),
    );
  });
});
