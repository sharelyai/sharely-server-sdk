// Client side of the Temporal-backed agent server.
//
// `fromTemporal` turns a Temporal workflow into a Sharely `Handler`. On each
// chat turn it `client.start()`s a workflow execution and polls its
// `AGENT_EVENTS_QUERY` event-buffer query until the workflow emits
// `message_end`, yielding AgentEvents as they arrive. Client disconnect
// (`input.signal`) cancels the workflow.
//
// This file never imports `@temporalio/client` — it accepts any structural
// `TemporalClientLike`. `server.ts` wires a real Temporal `Client` through
// `wrapTemporalClient` below.

import { fromTemporal } from '@sharelyai/adapter-temporal';
import type { TemporalClientLike } from '@sharelyai/adapter-temporal';
import type { Handler } from '@sharelyai/protocol';

export interface TemporalHandlerOptions {
  client: TemporalClientLike;
  /** Registered workflow name on the worker. */
  workflowType?: string;
  /** Task queue the worker polls. */
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
 * Adapt the real `@temporalio/client` `Client` to the flat `TemporalClientLike`
 * shape the adapter consumes. Real clients expose `client.workflow.start(...)`
 * (nested); the adapter wants `client.start(...)` (flat). Typed structurally so
 * this file doesn't pin the Temporal client version. The real handle's
 * `cancel()` returns the cancellation response, which we discard to satisfy
 * `TemporalWorkflowHandle`.
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
