/**
 * Structural shapes for the Vercel AI SDK `streamText` result. Typed
 * defensively (not imported from `ai`) so the adapter survives `ai` major
 * versions — field names shifted across v3/v4/v5 and are read with fallbacks.
 */
export interface VercelStreamPart {
  type: string;
  textDelta?: string;
  text?: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  name?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
  source?: {
    id?: string;
    sourceType?: string;
    url?: string;
    title?: string;
  };
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  error?: unknown;
}

export interface VercelStreamResult {
  fullStream: AsyncIterable<VercelStreamPart>;
}

export interface VercelAdapterOptions {
  /** Model identifier surfaced on the `message_start` event. */
  model?: string;
}
