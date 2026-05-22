import type {
  Tool,
  ToolContext,
  ToolDefinition,
  ToolResult
} from "@sharely/protocol";
import { definitions } from "./definitions.js";

export * from "./definitions.js";

export type ToolExecutor = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

export type ExecutorRegistry = Partial<Record<string, ToolExecutor>>;

const notImplemented = (name: string): ToolExecutor => async () => ({
  error: `Tool ${name} has no executor wired. Provide one via createTools({ [${JSON.stringify(name)}]: yourExecutor }) or attach @sharely/api once it ships.`
});

export const getToolDefinitions = (): ToolDefinition[] => definitions;

export const getDefinitionByName = (
  name: string
): ToolDefinition | undefined =>
  definitions.find(d => d.name === name);

export const createTools = (executors: ExecutorRegistry = {}): Tool[] =>
  definitions.map(definition => ({
    definition,
    execute: executors[definition.name] ?? notImplemented(definition.name)
  }));

export const executeTool = async (
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
  executors: ExecutorRegistry = {}
): Promise<ToolResult> => {
  const executor = executors[name];
  if (!executor) return { error: `Unknown tool: ${name}` };
  return executor(input, context);
};

export { createPlatformExecutors } from "./platform.js";
