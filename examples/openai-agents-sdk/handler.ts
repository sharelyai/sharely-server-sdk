// Pattern C — raw Sharely `Handler` driving the OpenAI Agents SDK.
//
// Copy this into your project. You will need:
//   npm i @openai/agents @sharely/protocol
//
// Unlike the Anthropic example, the Agents SDK runs your tools itself — this
// handler only observes the run and translates events. Text deltas come from
// `raw_model_stream_event`s; `tool_called` / `tool_output` come from
// `run_item_stream_event`s. Sources are pulled out of tool outputs by
// convention (`{ output, sources }`) and emitted in one batched event.

import { Agent, run } from '@openai/agents';
import type {
  AgentEvent,
  AgentInput,
  Handler,
  Source,
} from '@sharely/protocol';

export interface OpenAIAgentsHandlerOptions {
  agent: Agent;
  /** Surfaced on the `message_start` event. */
  model?: string;
  /** Forwarded to `run({ maxTurns })`. */
  maxTurns?: number;
}

export const createOpenAIAgentsHandler = (
  opts: OpenAIAgentsHandlerOptions,
): Handler => {
  const { agent, model, maxTurns } = opts;

  return async function* (input: AgentInput): AsyncIterable<AgentEvent> {
    yield {
      type: 'message_start',
      role: 'assistant',
      model: model ?? 'openai-agents',
    };

    // Build the runner input: prior turns + the new user message. The SDK
    // accepts either a string or an array of message-like items.
    const runnerInput = [
      ...input.history.map(m => ({
        role: m.role,
        content: m.content ?? '',
      })),
      { role: 'user' as const, content: input.message },
    ];

    let stream: Awaited<ReturnType<typeof run>>;
    try {
      stream = await run(agent, runnerInput as never, {
        stream: true,
        ...(maxTurns ? { maxTurns } : {}),
      });
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    // The SDK doesn't take an AbortSignal on run() in every version. Bridge
    // input.signal to stream.abort() so client disconnects halt the in-flight
    // model + tool calls. If your @openai/agents version exposes a signal
    // option on run(), pass it through there too.
    const onAbort = () => {
      try {
        (stream as { abort?: () => void }).abort?.();
      } catch {
        /* noop */
      }
    };
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener('abort', onAbort, { once: true });

    const collectedSources: Source[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'stop';

    try {
      for await (const event of stream) {
        if (input.signal.aborted) return;

        // Switch on the discriminant — TS narrows each branch to the matching
        // RunStreamEvent variant. Nested shapes (Responses API events, run
        // items) still need defensive reads since those move across versions.
        if (event.type === 'raw_model_stream_event') {
          const d = event.data as {
            type?: string;
            delta?: string;
            response?: {
              usage?: { input_tokens?: number; output_tokens?: number };
            };
          };
          if (
            d.type === 'response.output_text.delta' &&
            typeof d.delta === 'string'
          ) {
            yield { type: 'content_delta', delta: d.delta };
          } else if (d.type === 'response.completed') {
            inputTokens += d.response?.usage?.input_tokens ?? 0;
            outputTokens += d.response?.usage?.output_tokens ?? 0;
          }
        } else if (event.type === 'run_item_stream_event') {
          const item = event.item as unknown as Record<string, unknown>;

          if (event.name === 'tool_called') {
            yield {
              type: 'tool_call_start',
              toolCallId: pickToolCallId(item),
              name: pickToolName(item),
              input: pickToolInput(item),
            };
          } else if (event.name === 'tool_output') {
            const output = item['output'];
            if (output && typeof output === 'object' && 'sources' in output) {
              const ss = (output as { sources?: Source[] }).sources;
              if (Array.isArray(ss)) collectedSources.push(...ss);
            }
            yield {
              type: 'tool_call_end',
              toolCallId: pickToolCallId(item),
              output,
              durationMs: 0,
            };
          }
          // Other run items (handoffs, reasoning, message_output_created)
          // are not surfaced — extend here if your UI needs them.
        }
        // agent_updated_stream_event (handoffs) is ignored.
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    } finally {
      input.signal.removeEventListener?.('abort', onAbort);
    }

    if (input.signal.aborted) return;
    if (collectedSources.length > 0) {
      yield { type: 'sources', sources: collectedSources };
    }
    yield { type: 'content_end' };
    yield {
      type: 'message_end',
      finishReason,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  };
};

// ---------- Defensive accessors ----------
// Agents SDK item shapes vary by version; these read the common locations.

const pickToolCallId = (item: Record<string, unknown>): string => {
  const direct = item['callId'] ?? item['id'];
  if (typeof direct === 'string' && direct) return direct;
  const raw = item['rawItem'] as
    | { callId?: string; id?: string }
    | undefined;
  const fromRaw = raw?.callId ?? raw?.id;
  if (typeof fromRaw === 'string' && fromRaw) return fromRaw;
  throw new Error(
    'OpenAI Agents adapter: tool call id missing on run_item — SDK shape drifted. Update pickToolCallId for your @openai/agents version.',
  );
};

const pickToolName = (item: Record<string, unknown>): string => {
  const direct = item['name'];
  if (typeof direct === 'string' && direct) return direct;
  const raw = item['rawItem'] as { name?: string } | undefined;
  if (typeof raw?.name === 'string' && raw.name) return raw.name;
  throw new Error(
    'OpenAI Agents adapter: tool name missing on run_item — SDK shape drifted. Update pickToolName for your @openai/agents version.',
  );
};

const pickToolInput = (item: Record<string, unknown>): Record<string, unknown> => {
  const raw = item['rawItem'] as { arguments?: unknown } | undefined;
  const candidates = [item['arguments'], item['input'], raw?.arguments];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string') {
      try {
        return JSON.parse(c) as Record<string, unknown>;
      } catch {
        /* try next */
      }
    } else if (typeof c === 'object') {
      return c as Record<string, unknown>;
    }
  }
  return {};
};
