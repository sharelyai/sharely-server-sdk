import type { AgentContext, SharelyAPIClient, TraceSpan } from "@sharely/protocol";
import { logger } from "./logger.js";

const apiClient = (baseUrl: string, workspaceId: string, roleId?: string | null): SharelyAPIClient => ({
  baseUrl, workspaceId, ...(roleId != null && { roleId })
});

const traceSpan = (traceId: string, messageId: string, name: string): TraceSpan => {
  const tag = `${name}[${traceId}:${messageId}]`;
  return {
    traceId, messageId,
    event: (e, p) => logger.debug(`trace ${tag} ${e}`, p ?? {}),
    child: n => traceSpan(traceId, messageId, `${name}.${n}`),
    end: p => logger.debug(`trace ${tag} end`, p ?? {})
  };
};

export interface BuildContextOptions {
  workspaceId: string;
  threadId: string;
  authorization: string;
  apiBaseUrl: string;
  traceId: string;
  messageId: string;
  spaceId?: string | null;
  userId?: string;
  temporalUserId?: string;
  roleId?: string | null;
  languageId?: string;
  topK?: number;
}

export const buildAgentContext = (o: BuildContextOptions): AgentContext => ({
  workspaceId: o.workspaceId,
  threadId: o.threadId,
  ...(o.spaceId && { spaceId: o.spaceId }),
  ...(o.userId && { userId: o.userId }),
  ...(o.temporalUserId && { temporalUserId: o.temporalUserId }),
  ...(o.roleId !== undefined && { roleId: o.roleId }),
  ...(o.languageId && { languageId: o.languageId }),
  ...(o.topK !== undefined && { topK: o.topK }),
  authorization: o.authorization,
  api: apiClient(o.apiBaseUrl, o.workspaceId, o.roleId),
  trace: traceSpan(o.traceId, o.messageId, "agent")
});
