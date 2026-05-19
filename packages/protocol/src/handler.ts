import type { AgentEvent } from "./events.js";
import type { AgentMessage } from "./domain.js";
import type { SharelyAPIClient } from "./api.js";
import type { TraceSpan } from "./trace.js";

export interface AgentContext {
  workspaceId: string;
  spaceId?: string;
  threadId: string;
  userId?: string;
  temporalUserId?: string;
  roleId?: string | null;
  languageId?: string;
  topK?: number;
  authorization: string;
  api: SharelyAPIClient;
  trace: TraceSpan;
}

export interface AgentInput {
  message: string;
  history: AgentMessage[];
  context: AgentContext;
  signal: AbortSignal;
}

export type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;
