export interface ThinkingStep {
  id: string;
  title: string;
  content: string;
  status: "in_progress" | "completed" | "error";
  durationMs?: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: "in_progress" | "completed" | "error";
  durationMs?: number;
}

export interface Source {
  id: string;
  type: "knowledge" | "semantic" | "role" | "stats" | "taxonomy";
  title: string;
  url?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | null;
}
