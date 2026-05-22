import type {
  AgentEvent,
  AgentInput,
  Handler,
  Source,
  TokenUsage
} from "@sharely/protocol";
import type {
  VercelAdapterOptions,
  VercelStreamPart,
  VercelStreamResult
} from "./types.js";

const readText = (p: VercelStreamPart): string =>
  p.textDelta ?? p.text ?? p.delta ?? "";

const readUsage = (p: VercelStreamPart): TokenUsage => {
  const u = p.usage ?? {};
  const inputTokens = u.inputTokens ?? u.promptTokens ?? 0;
  const outputTokens = u.outputTokens ?? u.completionTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: u.totalTokens ?? inputTokens + outputTokens
  };
};

/**
 * Wraps a Vercel AI SDK `streamText` call as a Sharely `Handler`.
 *
 * `produce` is invoked per turn and must return a `streamText` result (or any
 * object exposing a `fullStream`). The customer owns model choice, prompt,
 * tools, and history wiring inside `produce` — the adapter is a pure
 * translator of the output stream into `AgentEvent`s. Pass `input.signal` to
 * `streamText`'s `abortSignal` to honor client disconnects.
 */
export const toSharelyHandler = (
  produce: (
    input: AgentInput
  ) => VercelStreamResult | Promise<VercelStreamResult>,
  options: VercelAdapterOptions = {}
): Handler =>
  async function* (input): AsyncIterable<AgentEvent> {
    yield {
      type: "message_start",
      role: "assistant",
      model: options.model ?? "vercel-ai"
    };

    const sources: Source[] = [];
    let thinkingId: string | null = null;
    let thinkingSeq = 0;
    let finishReason = "stop";
    let tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    };

    let result: VercelStreamResult;
    try {
      result = await produce(input);
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : "stream creation failed"
      };
      return;
    }

    for await (const part of result.fullStream) {
      if (input.signal.aborted) return;

      if (part.type === "reasoning" || part.type === "reasoning-delta") {
        if (!thinkingId) {
          thinkingId = `think-${++thinkingSeq}`;
          yield { type: "thinking_start", thinkingId, title: "Reasoning" };
        }
        yield { type: "thinking_delta", thinkingId, delta: readText(part) };
        continue;
      }

      // Any non-reasoning part closes an open thinking step.
      if (thinkingId) {
        yield {
          type: "thinking_end",
          thinkingId,
          status: "completed",
          durationMs: 0
        };
        thinkingId = null;
      }

      switch (part.type) {
        case "text-delta":
        case "text": {
          const delta = readText(part);
          if (delta) yield { type: "content_delta", delta };
          break;
        }
        case "tool-call":
          yield {
            type: "tool_call_start",
            toolCallId: String(part.toolCallId ?? ""),
            name: String(part.toolName ?? part.name ?? "tool"),
            input: (part.args ?? part.input ?? {}) as Record<string, unknown>
          };
          break;
        case "tool-result":
          yield {
            type: "tool_call_end",
            toolCallId: String(part.toolCallId ?? ""),
            output: part.result ?? part.output,
            durationMs: 0
          };
          break;
        case "source": {
          const s = part.source ?? {};
          sources.push({
            id: String(s.id ?? `src-${sources.length + 1}`),
            type: "semantic",
            title: String(s.title ?? "Source"),
            ...(s.url ? { url: s.url } : {})
          });
          break;
        }
        case "error":
          yield {
            type: "error",
            error:
              part.error instanceof Error
                ? part.error.message
                : String(part.error ?? "stream error")
          };
          return;
        case "finish":
          finishReason = part.finishReason ?? "stop";
          tokenUsage = readUsage(part);
          break;
        default:
          // step-start / step-finish / tool-input-* and other parts are ignored.
          break;
      }
    }

    if (input.signal.aborted) return;
    if (sources.length > 0) yield { type: "sources", sources };
    yield { type: "content_end" };
    yield { type: "message_end", finishReason, tokenUsage };
  };
