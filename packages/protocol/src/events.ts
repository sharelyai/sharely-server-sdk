import type { Source } from "./domain.js";
import type { TokenUsage } from "./domain.js";

export type SSEEventType =
  | "message_start"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "tool_call_start"
  | "tool_call_end"
  | "content_delta"
  | "content_end"
  | "sources"
  | "message_end"
  | "error"
  | "done";

export interface MessageStartEvent {
  type: "message_start";
  role: "assistant";
  model: string;
}

export interface ThinkingStartEvent {
  type: "thinking_start";
  thinkingId: string;
  title: string;
}

export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  thinkingId: string;
  delta: string;
}

export interface ThinkingEndEvent {
  type: "thinking_end";
  thinkingId: string;
  status: "completed" | "error";
  durationMs: number;
}

export interface ToolCallStartEvent {
  type: "tool_call_start";
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallEndEvent {
  type: "tool_call_end";
  toolCallId: string;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface ContentDeltaEvent {
  type: "content_delta";
  delta: string;
}

export interface ContentEndEvent {
  type: "content_end";
}

export interface SourcesEvent {
  type: "sources";
  sources: Source[];
}

export interface MessageEndEvent {
  type: "message_end";
  finishReason: string;
  tokenUsage: TokenUsage;
}

export interface ErrorEvent {
  type: "error";
  error: string;
}

export type AgentEvent =
  | MessageStartEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | ContentDeltaEvent
  | ContentEndEvent
  | SourcesEvent
  | MessageEndEvent
  | ErrorEvent;

export interface WireEnvelope {
  threadId: string;
  messageId: string;
}

export interface DoneEvent extends WireEnvelope {
  type: "done";
}

export type WireEvent =
  | (AgentEvent & WireEnvelope)
  | DoneEvent;
