import type { AgentEvent } from '@sharelyai/protocol';
import type { AgentEventPage } from './types.js';

/** Query name the client polls and the workflow must register a handler for. */
export const AGENT_EVENTS_QUERY = 'sharely_agentEvents';

export interface AgentEventSink {
  /** Append an event to the buffer (call as the agent produces output). */
  emit(event: AgentEvent): void;
  /** Query handler — register with `setHandler(defineQuery(AGENT_EVENTS_QUERY), sink.query)`. */
  query(cursor: number): AgentEventPage;
  /** Force-terminate the stream (e.g. on workflow cancellation). */
  complete(): void;
}

/**
 * Workflow-side event buffer. Create one per workflow execution (never a
 * module-level singleton — Temporal workers reuse the module across workflow
 * instances). The buffer auto-marks `done` once a `message_end` or `error`
 * event is emitted.
 *
 * ```ts
 * const sink = createAgentEventSink();
 * setHandler(defineQuery(AGENT_EVENTS_QUERY), sink.query);
 * emitAgentEvent(sink, { type: "message_start", role: "assistant", model: "..." });
 * ```
 */
export const createAgentEventSink = (): AgentEventSink => {
  const buffer: AgentEvent[] = [];
  let done = false;
  return {
    emit(event) {
      buffer.push(event);
      if (event.type === 'message_end' || event.type === 'error') done = true;
    },
    query(cursor) {
      const from = Math.max(0, cursor);
      return { events: buffer.slice(from), done, cursor: buffer.length };
    },
    complete() {
      done = true;
    },
  };
};

/** Emits an event into a sink. Thin helper for symmetry with the client API. */
export const emitAgentEvent = (
  sink: AgentEventSink,
  event: AgentEvent,
): void => {
  sink.emit(event);
};
