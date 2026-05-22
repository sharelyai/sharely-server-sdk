import type { AgentEvent } from "@sharely/protocol";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const KNOWN_TYPES = new Set<AgentEvent["type"]>([
  "message_start",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "tool_call_start",
  "tool_call_end",
  "content_delta",
  "content_end",
  "sources",
  "message_end",
  "error"
]);

/**
 * Structural + ordering validation of an AgentEvent stream — the wire-protocol
 * contract every Handler (and every adapter) must satisfy:
 *
 *  - message_start, if present, is first; at most one.
 *  - thinking_delta / thinking_end reference an open thinking_start.
 *  - tool_call_end references an open tool_call_start.
 *  - content_delta never follows content_end; at most one content_end.
 *  - every thinking step and tool call is closed.
 *  - the stream terminates with message_end or error; nothing follows either.
 */
export const validateEventStream = (events: AgentEvent[]): ValidationResult => {
  const errors: string[] = [];
  const seenThinking = new Set<string>();
  const openThinking = new Set<string>();
  const seenTools = new Set<string>();
  const openTools = new Set<string>();
  let started = false;
  let ended = false;
  let errored = false;
  let contentEnded = false;

  events.forEach((e, i) => {
    const at = `event #${i} (${e?.type ?? "?"})`;
    if (ended) errors.push(`${at} appears after message_end`);
    if (errored) errors.push(`${at} appears after error`);
    if (!e || !KNOWN_TYPES.has(e.type)) {
      errors.push(`${at} is not a known AgentEvent type`);
      return;
    }

    switch (e.type) {
      case "message_start":
        if (started) errors.push(`${at} duplicate message_start`);
        if (i !== 0) errors.push(`${at} message_start must be the first event`);
        started = true;
        break;
      case "thinking_start":
        if (seenThinking.has(e.thinkingId))
          errors.push(`${at} duplicate thinking id "${e.thinkingId}"`);
        seenThinking.add(e.thinkingId);
        openThinking.add(e.thinkingId);
        break;
      case "thinking_delta":
        if (!openThinking.has(e.thinkingId))
          errors.push(`${at} delta for unopened thinking id "${e.thinkingId}"`);
        break;
      case "thinking_end":
        if (!openThinking.has(e.thinkingId))
          errors.push(`${at} end for unopened thinking id "${e.thinkingId}"`);
        openThinking.delete(e.thinkingId);
        break;
      case "tool_call_start":
        if (seenTools.has(e.toolCallId))
          errors.push(`${at} duplicate tool call id "${e.toolCallId}"`);
        seenTools.add(e.toolCallId);
        openTools.add(e.toolCallId);
        break;
      case "tool_call_end":
        if (!openTools.has(e.toolCallId))
          errors.push(`${at} end for unopened tool call id "${e.toolCallId}"`);
        openTools.delete(e.toolCallId);
        break;
      case "content_delta":
        if (contentEnded) errors.push(`${at} content_delta after content_end`);
        break;
      case "content_end":
        if (contentEnded) errors.push(`${at} duplicate content_end`);
        contentEnded = true;
        break;
      case "sources":
        break;
      case "message_end":
        ended = true;
        break;
      case "error":
        errored = true;
        break;
    }
  });

  for (const id of openThinking) errors.push(`thinking step "${id}" never closed`);
  for (const id of openTools) errors.push(`tool call "${id}" never closed`);
  if (!ended && !errored)
    errors.push("stream terminated without message_end or error");

  return { ok: errors.length === 0, errors };
};

/** Compares an actual stream against a golden stream, type-by-type. */
export const checkGolden = (
  actual: AgentEvent[],
  golden: AgentEvent[]
): ValidationResult => {
  const errors: string[] = [];
  if (actual.length !== golden.length)
    errors.push(
      `event count: expected ${golden.length}, got ${actual.length}`
    );
  const n = Math.min(actual.length, golden.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const g = golden[i]!;
    if (a.type !== g.type)
      errors.push(`event #${i}: expected "${g.type}", got "${a.type}"`);
  }
  return { ok: errors.length === 0, errors };
};
