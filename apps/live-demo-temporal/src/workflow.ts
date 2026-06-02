// The workflow runs in Temporal's deterministic sandbox — no I/O here. It
// exposes its event buffer via the adapter's `AGENT_EVENTS_QUERY` query (which
// the client polls), delegates the actual LLM/tool work to the `runAgent`
// activity, then relays the returned AgentEvents into the sink.
//
// `import type` for the activities keeps their Node-only code (fetch, env) out
// of the workflow bundle — only the function *types* are referenced here.

import {
  proxyActivities,
  defineQuery,
  setHandler,
  CancellationScope,
  isCancellation,
} from '@temporalio/workflow';
import {
  AGENT_EVENTS_QUERY,
  createAgentEventSink,
  emitAgentEvent,
} from '@sharelyai/adapter-temporal';
import type { AgentEvent } from '@sharelyai/protocol';
import type * as activities from './activities.js';

const { runAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '30 seconds',
});

export const sharelyAgentWorkflow = async (
  input: activities.WorkflowInput,
): Promise<void> => {
  const sink = createAgentEventSink();
  setHandler(
    defineQuery<
      { events: AgentEvent[]; done: boolean; cursor?: number },
      [number]
    >(AGENT_EVENTS_QUERY),
    sink.query,
  );

  try {
    const events = await runAgent(input);
    for (const event of events) emitAgentEvent(sink, event);
  } catch (err) {
    if (isCancellation(err)) {
      // Client disconnected → workflow cancelled. Nothing is polling anymore;
      // just close the buffer (in a non-cancellable scope) and re-raise so
      // Temporal records the run as cancelled.
      await CancellationScope.nonCancellable(async () => sink.complete());
      throw err;
    }
    emitAgentEvent(sink, {
      type: 'error',
      error: err instanceof Error ? err.message : 'workflow failed',
    });
  } finally {
    sink.complete();
  }
};
