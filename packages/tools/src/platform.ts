import { definitions } from './definitions.js';

// types
import type { ToolContext, ToolResult } from '@sharelyai/protocol';
import type { SharelyAPIClient, ToolExecuteContext } from '@sharelyai/api';
import type { ExecutorRegistry, ToolExecutor } from './index.js';

const toExecuteContext = (ctx: ToolContext): ToolExecuteContext => ({
  ...(ctx.spaceId !== undefined && { spaceId: ctx.spaceId }),
  ...(ctx.userId !== undefined && { userId: ctx.userId }),
  ...(ctx.roleId !== undefined && { roleId: ctx.roleId }),
  ...(ctx.languageId !== undefined && { languageId: ctx.languageId }),
  ...(ctx.topK !== undefined && { topK: ctx.topK }),
});

/**
 * Platform-backed executors for **every** first-party Sharely tool definition.
 *
 * All tools are routed through the single dispatcher endpoint
 * `POST /v1/workspaces/:wsId/agent/tools/:name/execute` exposed by
 * `sharelyai-be`.
 *
 * Pass the result to `createTools(...)`.
 *
 * ```ts
 * import { createTools, createPlatformExecutors } from '@sharelyai/tools';
 * const tools = createTools(createPlatformExecutors(context.api));
 * ```
 */
export const createPlatformExecutors = (
  api: SharelyAPIClient,
): ExecutorRegistry => {
  const registry: ExecutorRegistry = {};
  for (const def of definitions) {
    const executor: ToolExecutor = async (input, ctx) => {
      const result = await api.executeTool(def.name, {
        input,
        context: toExecuteContext(ctx),
      });
      return result as ToolResult;
    };
    registry[def.name] = executor;
  }
  return registry;
};
