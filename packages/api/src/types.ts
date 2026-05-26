import type {
  Source,
  ThinkingStep,
  TokenUsage,
  ToolCallRecord,
} from '@sharelyai/protocol';

export interface CreateThreadInput {
  title: string;
  spaceId?: string | null;
  userId?: string | null;
  temporalUserId?: string | null;
  agentServerId?: string | null;
}

export interface ThreadListInput {
  spaceId?: string | null;
  userId?: string | null;
  temporalUserId?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface AgentThread {
  id: string;
  title?: string | null;
  status?: string;
  spaceId?: string | null;
  userId?: string | null;
  temporalUserId?: string | null;
  agentServerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentThreadWithMessages extends AgentThread {
  messages: StoredAgentMessage[];
}

export interface StoredAgentMessage {
  id: string;
  threadId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | null;
  thinkingSteps?: ThinkingStep[];
  toolCalls?: ToolCallRecord[];
  sources?: Source[];
  tokenUsage?: TokenUsage;
  model?: string | null;
  finishReason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface ThreadListResponse {
  items: AgentThread[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface StoreMessageInput {
  /**
   * Required. The Backplane uses this to upsert into a pre-created draft row
   * (assistant messages seeded by sharelyai-be's chat() controller so logs
   * can FK-reference messageId from the very first event) or to create a new
   * row with a known id (user messages). The Backplane rejects any id that
   * already belongs to a different thread.
   */
  id: string;
  role: 'user' | 'assistant';
  content: string | null;
  thinkingSteps?: ThinkingStep[];
  toolCalls?: ToolCallRecord[];
  sources?: Source[];
  tokenUsage?: TokenUsage;
  model?: string;
  finishReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecuteContext {
  spaceId?: string;
  userId?: string;
  roleId?: string | null;
  languageId?: string;
  topK?: number;
}

export interface ToolExecuteInput {
  input: Record<string, unknown>;
  context?: ToolExecuteContext;
}

export interface ToolExecuteResult {
  output?: unknown;
  sources?: Source[];
  error?: string;
}

export interface TokenValidationResult {
  id?: string;
  temporalUserId?: string;
  user_metadata?: {
    roleId?: string;
    customerRoleId?: string;
    [key: string]: unknown;
  };
}
