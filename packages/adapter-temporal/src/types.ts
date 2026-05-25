import type { AgentEvent, AgentInput } from '@sharelyai/protocol';

/** A page of buffered events returned by the workflow's query handler. */
export interface AgentEventPage {
  events: AgentEvent[];
  done: boolean;
  /** Next cursor to poll with. Defaults to `cursor + events.length` when omitted. */
  cursor?: number;
}

/** An abstract pull-based event source — the polling target of `pollingHandler`. */
export interface AgentEventSource {
  poll(cursor: number): Promise<AgentEventPage>;
  cancel(): Promise<void>;
}

/**
 * Minimal structural shapes for `@temporalio/client` — typed here rather than
 * imported so the adapter does not pin a Temporal SDK version.
 */
export interface TemporalWorkflowHandle {
  query<T>(queryType: string, ...args: unknown[]): Promise<T>;
  cancel(): Promise<void>;
}

export interface TemporalClientLike {
  start(
    workflowType: string,
    options: { taskQueue: string; workflowId: string; args?: unknown[] },
  ): Promise<TemporalWorkflowHandle>;
}

export interface FromTemporalOptions {
  client: TemporalClientLike;
  workflowType: string;
  taskQueue: string;
  /** Builds the workflowId for a turn. Default: `sharely-<threadId>-<messageId>`. */
  workflowId?: (input: AgentInput) => string;
  /** Poll interval when the workflow has produced no new events. Default 250ms. */
  pollIntervalMs?: number;
}
