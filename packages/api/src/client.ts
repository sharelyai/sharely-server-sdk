import { defaultTransport, type Transport } from './transport.js';

import type { SharelyAPIClient as ProtocolStub } from '@sharelyai/protocol';
import type {
  AgentThread,
  AgentThreadWithMessages,
  CreateThreadInput,
  StoreMessageInput,
  StoredAgentMessage,
  ThreadListInput,
  ThreadListResponse,
  TokenValidationResult,
  ToolExecuteInput,
  ToolExecuteResult,
} from './types.js';

export interface SharelyAPIClientConfig {
  baseUrl: string;
  workspaceId: string;
  authorization: string;
  roleId?: string | null;
  transport?: Transport;
}

const qs = (params: Readonly<Record<string, unknown>>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export interface SharelyAPIClient extends ProtocolStub {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly roleId?: string | null;
  threads: {
    create(input: CreateThreadInput): Promise<AgentThread>;
    list(input?: ThreadListInput): Promise<ThreadListResponse>;
    get(threadId: string): Promise<AgentThreadWithMessages>;
    messages: {
      create(
        threadId: string,
        message: StoreMessageInput,
      ): Promise<StoredAgentMessage>;
    };
  };
  tokens: {
    validate(token: string): Promise<TokenValidationResult>;
  };
  executeTool(name: string, body: ToolExecuteInput): Promise<ToolExecuteResult>;
}

export const createSharelyAPIClient = (
  cfg: SharelyAPIClientConfig,
): SharelyAPIClient => {
  const transport = cfg.transport ?? defaultTransport(cfg.baseUrl);
  const headers = { authorization: cfg.authorization };
  const ws = encodeURIComponent(cfg.workspaceId);
  const threadsBase = `/v1/workspaces/${ws}/agent/threads`;

  return {
    baseUrl: cfg.baseUrl,
    workspaceId: cfg.workspaceId,
    ...(cfg.roleId !== undefined && { roleId: cfg.roleId }),
    threads: {
      create: async input =>
        (
          await transport<AgentThread>({
            method: 'POST',
            url: threadsBase,
            body: input,
            headers,
          })
        ).data,
      list: async (input = {}) =>
        (
          await transport<ThreadListResponse>({
            method: 'GET',
            url: `${threadsBase}${qs({ ...input })}`,
            headers,
          })
        ).data,
      get: async threadId =>
        (
          await transport<AgentThreadWithMessages>({
            method: 'GET',
            url: `${threadsBase}/${encodeURIComponent(threadId)}`,
            headers,
          })
        ).data,
      messages: {
        create: async (threadId, message) =>
          (
            await transport<StoredAgentMessage>({
              method: 'POST',
              url: `${threadsBase}/${encodeURIComponent(threadId)}/messages`,
              body: message,
              headers,
            })
          ).data,
      },
    },
    tokens: {
      validate: async token =>
        (
          await transport<TokenValidationResult>({
            method: 'POST',
            url: `/v1/workspaces/${ws}/api-authenticated`,
            body: { token },
            headers,
          })
        ).data,
    },
    executeTool: async (name, body) =>
      (
        await transport<ToolExecuteResult>({
          method: 'POST',
          url: `/v1/workspaces/${ws}/agent/tools/${encodeURIComponent(name)}/execute`,
          body,
          headers,
        })
      ).data,
  };
};
