import { jsonSchema, tool } from 'ai';
import type { AgentContext, ToolContext } from '@sharelyai/protocol';
import type { SharelyAPIClient } from '@sharelyai/api';
import {
  createPlatformExecutors,
  getDefinitionByName,
  type ToolExecutor,
} from '@sharelyai/tools';

/**
 * `@sharelyai/adapter-vercel-ai/tools` — the first-party Sharely tools wrapped as
 * Vercel AI SDK `tool()`s, ready to drop into `streamText({ tools })`.
 *
 * ```ts
 * import { streamText } from "ai";
 * import { semanticSearch } from "@sharelyai/adapter-vercel-ai/tools";
 *
 * export const handler = fromVercelAI(({ message, history, context }) =>
 *   streamText({
 *     model: anthropic("claude-sonnet-4-6"),
 *     messages: [...history, { role: "user", content: message }],
 *     tools: { semantic_search: semanticSearch(context) }
 *   })
 * );
 * ```
 *
 * Each factory takes the `AgentContext` from the Handler. `semantic_search` is
 * backed by the platform (`@sharelyai/api.rag()`) out of the box; the others have
 * no Backplane endpoint yet — pass your own executor as the second argument.
 */

const toToolContext = (ctx: AgentContext): ToolContext => ({
  workspaceId: ctx.workspaceId,
  ...(ctx.spaceId ? { spaceId: ctx.spaceId } : {}),
  ...(ctx.userId ? { userId: ctx.userId } : {}),
  ...(ctx.languageId ? { languageId: ctx.languageId } : {}),
  ...(ctx.topK !== undefined ? { topK: ctx.topK } : {}),
  ...(ctx.roleId !== undefined ? { roleId: ctx.roleId } : {}),
});

const sharelyTool =
  (name: string) => (context: AgentContext, executor?: ToolExecutor) => {
    const def = getDefinitionByName(name);
    if (!def) throw new Error(`Unknown Sharely tool: ${name}`);

    // `context.api` is typed as the @sharely/protocol stub; at runtime
    // @sharely/server populates it with a full @sharely/api client (rag(), …).
    const platform = createPlatformExecutors(context.api as SharelyAPIClient);
    const run = executor ?? platform[name];
    const toolContext = toToolContext(context);

    return tool({
      description: def.description,
      inputSchema: jsonSchema(
        def.input_schema as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (input: Record<string, unknown>) => {
        if (!run) {
          return {
            error: `Sharely tool "${name}" has no platform executor — pass one as the second argument to ${name}(context, executor).`,
          };
        }
        const result = await run(input, toolContext);
        return result.error ? { error: result.error } : (result.output ?? null);
      },
    });
  };

export const semanticSearch = sharelyTool('semantic_search');
export const searchKnowledge = sharelyTool('search_knowledge');
export const getKnowledgeItem = sharelyTool('get_knowledge_item');
export const listTaxonomies = sharelyTool('list_taxonomies');
export const getTaxonomyKnowledge = sharelyTool('get_taxonomy_knowledge');
export const getWorkspaceStats = sharelyTool('get_workspace_stats');
export const listRoles = sharelyTool('list_roles');
