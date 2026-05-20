import type {
  AgentMessage, Source, ThinkingStep, TokenUsage, ToolCallRecord
} from "@sharely/protocol";
import type { Fetcher } from "./fetcher.js";

export interface StoredMessage { id: string; role: "user" | "assistant"; content: string | null; }
export interface ThreadSnapshot { id: string; spaceId?: string | null; agentServerId?: string | null; messages: StoredMessage[]; }

export interface StoreMessageInput {
  role: "user" | "assistant";
  content: string | null;
  thinkingSteps?: ThinkingStep[];
  toolCalls?: ToolCallRecord[];
  sources?: Source[];
  tokenUsage?: TokenUsage;
  model?: string;
  finishReason?: string;
  metadata?: Record<string, unknown>;
}

const HISTORY_LIMIT = 50;

export const createBackplaneClient = (cfg: { fetcher: Fetcher; workspaceId: string; authorization: string; }) => {
  const base = `/v1/workspaces/${encodeURIComponent(cfg.workspaceId)}/agent/threads`;
  const headers = { authorization: cfg.authorization };
  return {
    async getThread(threadId: string): Promise<ThreadSnapshot> {
      return (await cfg.fetcher<ThreadSnapshot>({ url: `${base}/${encodeURIComponent(threadId)}`, headers })).data;
    },
    async loadHistory(threadId: string): Promise<AgentMessage[]> {
      const t = await this.getThread(threadId);
      return t.messages.slice(-HISTORY_LIMIT).map((m: StoredMessage) => ({ role: m.role, content: m.content }));
    },
    async storeMessage(threadId: string, message: StoreMessageInput): Promise<{ id: string }> {
      return (await cfg.fetcher<{ id: string }>({
        method: "POST",
        url: `${base}/${encodeURIComponent(threadId)}/messages`,
        body: message, headers
      })).data;
    }
  };
};

export type BackplaneClient = ReturnType<typeof createBackplaneClient>;
