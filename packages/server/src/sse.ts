import type { Response } from 'express';
import type { AgentEvent, DoneEvent, WireEnvelope } from '@sharelyai/protocol';

export type SSEEventType = AgentEvent['type'] | 'done';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export const writeSSEHeaders = (res: Response): void => {
  res.writeHead(200, SSE_HEADERS);
};

export const sendSSEEvent = (
  res: Response,
  type: SSEEventType,
  data: object,
): void => {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const sendAgentEvent = (
  res: Response,
  env: WireEnvelope,
  event: AgentEvent,
): void => {
  const { type, ...rest } = event;
  sendSSEEvent(res, type, { ...env, ...rest });
};

export const sendDone = (res: Response, env: WireEnvelope): void => {
  const payload: Omit<DoneEvent, 'type'> = env;
  sendSSEEvent(res, 'done', payload);
};

export const endSSEStream = (res: Response): void => {
  res.end();
};
