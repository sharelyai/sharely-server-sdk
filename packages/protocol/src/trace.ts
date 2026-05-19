/**
 * Stub for the tracing surface (TASK.md §10, Spec 06).
 *
 * Concrete implementations live in @sharely/server and adapter packages and
 * build on sharelyai-be/src/controller/agent/log.ts (traceId/messageId). The
 * shape is intentionally minimal so the protocol stays runtime-free.
 */
export interface TraceSpan {
  readonly traceId: string;
  readonly messageId: string;
  event(name: string, payload?: Record<string, unknown>): void;
  child(name: string): TraceSpan;
  end(payload?: Record<string, unknown>): void;
}
