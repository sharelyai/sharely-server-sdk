import { createSharelyAPIClient, type SharelyAPIClient } from '@sharelyai/api';

import type { AgentContext, TraceSpan } from '@sharelyai/protocol';
import { logger } from './logger.js';

const traceSpan = (
  traceId: string,
  messageId: string,
  name: string,
): TraceSpan => {
  const tag = `${name}[${traceId}:${messageId}]`;
  return {
    traceId,
    messageId,
    event: (e, p) => logger.debug(`trace ${tag} ${e}`, p ?? {}),
    child: n => traceSpan(traceId, messageId, `${name}.${n}`),
    end: p => logger.debug(`trace ${tag} end`, p ?? {}),
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
  apiClient?: SharelyAPIClient;
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
  api:
    o.apiClient ??
    createSharelyAPIClient({
      baseUrl: o.apiBaseUrl,
      workspaceId: o.workspaceId,
      authorization: o.authorization,
      ...(o.roleId !== undefined && { roleId: o.roleId }),
    }),
  trace: traceSpan(o.traceId, o.messageId, 'agent'),
});
