/**
 * Stub for the tracing surface. Concrete implementations live in
 * @sharelyai/server and adapter packages and build on sharelyai-be's
 * agent/log.ts (traceId/messageId). The shape is intentionally minimal so
 * the protocol stays runtime-free.
 */
export interface TraceSpan {
  readonly traceId: string;
  readonly messageId: string;
  event(name: string, payload?: Record<string, unknown>): void;
  child(name: string): TraceSpan;
  end(payload?: Record<string, unknown>): void;
}
