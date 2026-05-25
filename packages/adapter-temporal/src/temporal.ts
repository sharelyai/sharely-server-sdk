import { pollingHandler } from './poll.js';
import { AGENT_EVENTS_QUERY } from './sink.js';

import type { AgentInput, Handler } from '@sharelyai/protocol';
import type {
  AgentEventPage,
  AgentEventSource,
  FromTemporalOptions,
} from './types.js';

/** Plain, serializable subset of AgentContext passed into the workflow. */
const workflowContext = (input: AgentInput) => ({
  workspaceId: input.context.workspaceId,
  threadId: input.context.threadId,
  spaceId: input.context.spaceId,
  userId: input.context.userId,
  temporalUserId: input.context.temporalUserId,
  roleId: input.context.roleId,
  languageId: input.context.languageId,
  topK: input.context.topK,
});

/**
 * Wraps a Temporal workflow as a Sharely `Handler`. Each turn starts a
 * workflow execution, then polls the `AGENT_EVENTS_QUERY` query until the
 * workflow's event buffer reports `done`. Client disconnect (`input.signal`)
 * cancels the workflow.
 *
 * The workflow must register the query with a `createAgentEventSink()` buffer
 * and `emitAgentEvent` its way through `message_start` … `message_end`.
 */
export const fromTemporal = (options: FromTemporalOptions): Handler => {
  const createSource = async (input: AgentInput): Promise<AgentEventSource> => {
    const workflowId = options.workflowId
      ? options.workflowId(input)
      : `sharely-${input.context.threadId}-${input.context.trace.messageId}`;

    const handle = await options.client.start(options.workflowType, {
      taskQueue: options.taskQueue,
      workflowId,
      args: [
        {
          message: input.message,
          history: input.history,
          context: workflowContext(input),
        },
      ],
    });

    return {
      poll: cursor => handle.query<AgentEventPage>(AGENT_EVENTS_QUERY, cursor),
      cancel: () => handle.cancel(),
    };
  };

  return pollingHandler(createSource, options.pollIntervalMs ?? 250);
};
