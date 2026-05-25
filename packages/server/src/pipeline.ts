import type { Response } from 'express';
import type {
  AgentContext,
  AgentEvent,
  AgentInput,
  Handler,
  Source,
  ThinkingStep,
  TokenUsage,
  ToolCallRecord,
} from '@sharelyai/protocol';
import type { SharelyAPIClient, StoreMessageInput } from '@sharelyai/api';
import {
  endSSEStream,
  sendAgentEvent,
  sendDone,
  sendSSEEvent,
  writeSSEHeaders,
} from './sse.js';
import { logger } from './logger.js';

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface Accumulator {
  content: string;
  thinking: Map<string, ThinkingStep>;
  toolCalls: Map<string, ToolCallRecord>;
  sources: Source[];
  tokenUsage?: TokenUsage;
  model?: string;
  finishReason: string;
}

const reduce = (a: Accumulator, e: AgentEvent): void => {
  switch (e.type) {
    case 'message_start':
      a.model = e.model;
      return;
    case 'content_delta':
      a.content += e.delta;
      return;
    case 'thinking_start':
      a.thinking.set(e.thinkingId, {
        id: e.thinkingId,
        title: e.title,
        content: '',
        status: 'in_progress',
      });
      return;
    case 'thinking_delta': {
      const s = a.thinking.get(e.thinkingId);
      if (s) s.content += e.delta;
      return;
    }
    case 'thinking_end': {
      const s = a.thinking.get(e.thinkingId);
      if (s) {
        s.status = e.status;
        s.durationMs = e.durationMs;
      }
      return;
    }
    case 'tool_call_start':
      a.toolCalls.set(e.toolCallId, {
        id: e.toolCallId,
        name: e.name,
        input: e.input,
        status: 'in_progress',
      });
      return;
    case 'tool_call_end': {
      const c = a.toolCalls.get(e.toolCallId);
      if (c) {
        c.output = e.output;
        c.error = e.error;
        c.status = e.error ? 'error' : 'completed';
        c.durationMs = e.durationMs;
      }
      return;
    }
    case 'sources':
      a.sources = e.sources;
      return;
    case 'message_end':
      a.finishReason = e.finishReason;
      a.tokenUsage = e.tokenUsage;
      return;
    case 'content_end':
    case 'error':
      return;
  }
};

const assistant = (a: Accumulator): StoreMessageInput => ({
  role: 'assistant',
  content: a.content || null,
  thinkingSteps: [...a.thinking.values()],
  toolCalls: [...a.toolCalls.values()],
  sources: a.sources,
  ...(a.tokenUsage && { tokenUsage: a.tokenUsage }),
  ...(a.model && { model: a.model }),
  finishReason: a.finishReason,
});

export interface RunOptions {
  handler: Handler;
  context: AgentContext;
  message: string;
  res: Response;
  api: SharelyAPIClient;
}

const HISTORY_LIMIT = 50;

export const runHandler = async ({
  handler,
  context,
  message,
  res,
  api,
}: RunOptions): Promise<void> => {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  writeSSEHeaders(res);

  await api.threads.messages.create(context.threadId, {
    role: 'user',
    content: message,
  });
  const thread = await api.threads.get(context.threadId);
  const history = thread.messages
    .slice(-HISTORY_LIMIT)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const input: AgentInput = { message, history, context, signal: abort.signal };
  const envelope = {
    threadId: context.threadId,
    messageId: context.trace.messageId,
  };
  const acc: Accumulator = {
    content: '',
    thinking: new Map(),
    toolCalls: new Map(),
    sources: [],
    finishReason: 'stop',
  };
  let errored = false;

  try {
    for await (const event of handler(input)) {
      if (abort.signal.aborted) break;
      reduce(acc, event);
      sendAgentEvent(res, envelope, event);
    }
  } catch (err) {
    errored = true;
    logger.error('Handler error', err instanceof Error ? err.message : err);
    if (!res.writableEnded) {
      sendSSEEvent(res, 'error', {
        ...envelope,
        error: err instanceof Error ? err.message : 'Handler error',
      });
    }
  }

  if (!errored && !abort.signal.aborted) {
    try {
      const stored = await api.threads.messages.create(
        context.threadId,
        assistant(acc),
      );
      envelope.messageId = stored.id;
    } catch (err) {
      logger.error(
        'Failed to persist assistant message',
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!res.writableEnded) {
    sendDone(res, envelope);
    endSSEStream(res);
  }
};
