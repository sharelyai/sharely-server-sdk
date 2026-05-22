import type { ToolContext, ToolDefinition, ToolResult } from "@sharely/protocol";
import { definitions, type ExecutorRegistry } from "@sharely/tools";

export interface VercelToolShape {
  description: string;
  /** JSON Schema — wrap with `ai`'s `jsonSchema()` when registering. */
  inputSchema: ToolDefinition["input_schema"];
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Re-exports the first-party Sharely tool definitions in a Vercel-AI-friendly
 * shape. Bring your own executors; wrap each `inputSchema` with `ai`'s
 * `jsonSchema()` and the entry with `tool()` when passing to `streamText`.
 *
 * ```ts
 * import { tool, jsonSchema } from "ai";
 * const tools = Object.fromEntries(
 *   Object.entries(sharelyVercelTools(executors, ctx)).map(([name, t]) => [
 *     name,
 *     tool({ description: t.description, parameters: jsonSchema(t.inputSchema), execute: t.execute })
 *   ])
 * );
 * ```
 */
export const sharelyVercelTools = (
  executors: ExecutorRegistry,
  context: ToolContext
): Record<string, VercelToolShape> => {
  const out: Record<string, VercelToolShape> = {};
  for (const def of definitions) {
    const executor = executors[def.name];
    if (!executor) continue;
    out[def.name] = {
      description: def.description,
      inputSchema: def.input_schema,
      execute: input => executor(input, context)
    };
  }
  return out;
};

export { definitions as sharelyToolDefinitions } from "@sharely/tools";
