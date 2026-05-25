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

export interface RagInput {
  text: string;
  topK?: number;
  languageId?: string;
}

export interface RagMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
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
