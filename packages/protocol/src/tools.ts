import type { Source } from "./domain.js";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  workspaceId: string;
  spaceId?: string;
  userId?: string;
  languageId?: string;
  topK?: number;
  roleId?: string | null;
}

export interface ToolResult {
  output?: unknown;
  error?: string;
  sources?: Source[];
}

export interface Tool {
  definition: ToolDefinition;
  execute: (
    input: Record<string, unknown>,
    context: ToolContext
  ) => Promise<ToolResult>;
}
