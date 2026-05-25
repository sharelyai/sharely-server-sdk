// Adapter-backed Pattern — `@sharelyai/adapter-temporal` turns a Temporal
// workflow into a Sharely `Handler`. Each turn starts a workflow execution
// and polls its event-buffer query until `message_end`. The workflow side
// emits AgentEvents via createAgentEventSink + emitAgentEvent (see the
// README for the workflow + worker snippets).
//
// Copy into your project. You will need:
//   npm i @temporalio/client @sharelyai/adapter-temporal \
//         @sharelyai/server @sharelyai/protocol
//
// The handler itself doesn't import @temporalio/client — it accepts any
// `TemporalClientLike` (start + cancel + query). server.ts wires a real
// Temporal Client through wrapTemporalClient().

import { fromTemporal } from '@sharelyai/adapter-temporal';
import type { TemporalClientLike } from '@sharelyai/adapter-temporal';
import type { Handler } from '@sharelyai/protocol';

export interface TemporalHandlerOptions {
  client: TemporalClientLike;
  /** Registered workflow name on the worker. */
  workflowType?: string;
  /** Task queue your worker is polling. */
  taskQueue?: string;
  /** How often to re-query the workflow when no new events have arrived. */
  pollIntervalMs?: number;
}

export const createTemporalHandler = (opts: TemporalHandlerOptions): Handler =>
  fromTemporal({
    client: opts.client,
    workflowType: opts.workflowType ?? 'sharelyAgentWorkflow',
    taskQueue: opts.taskQueue ?? 'sharely-agents',
    pollIntervalMs: opts.pollIntervalMs ?? 200,
  });

/**
 * Adapt the real `@temporalio/client` `Client` to `TemporalClientLike`.
 *
 * Typed structurally so this file doesn't pin the Temporal client version.
 * The real handle returned by `client.workflow.start(...)` has a `cancel()`
 * that returns the cancellation response (not `void`), so we discard it
 * here to satisfy `TemporalWorkflowHandle`.
 */
export const wrapTemporalClient = (client: {
  workflow: {
    start: (
      workflowType: string,
      options: { taskQueue: string; workflowId: string; args?: unknown[] },
    ) => Promise<{
      query: <T>(queryType: string, ...args: unknown[]) => Promise<T>;
      cancel: () => Promise<unknown>;
    }>;
  };
}): TemporalClientLike => ({
  start: async (workflowType, options) => {
    const handle = await client.workflow.start(workflowType, options);
    return {
      query: (queryType, ...args) => handle.query(queryType, ...args),
      cancel: async () => {
        await handle.cancel();
      },
    };
  },
});
