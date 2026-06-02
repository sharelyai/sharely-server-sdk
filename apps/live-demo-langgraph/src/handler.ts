// Pattern C — raw Sharely `Handler` driving a LangGraph graph via streamEvents.
//
// LangGraph has no `@sharelyai/adapter-*` package: it owns the agent loop and
// tool execution, and this handler *observes* `streamEvents(input, { version:
// 'v2' })` and translates the relevant events to Sharely AgentEvents. Because
// there's no adapter, this translator lives in the app itself (it's the
// customer-form code). Sources are pulled out of tool outputs by convention
// (`{ ..., sources }`) and emitted in one batched event.

import type {
  AgentEvent,
  AgentInput,
  Handler,
  Source,
} from '@sharelyai/protocol';

/**
 * Minimal structural shape we require — anything with a `streamEvents` method
 * that yields LangChain `StreamEvent`-shaped objects works. Typed structurally
 * (not via `CompiledStateGraph<...>`) so the handler doesn't pin a specific
 * @langchain/langgraph version and surface its UpdateType machinery.
 */
export interface StreamableGraph {
  streamEvents(
    input: unknown,
    options: { version: 'v2'; signal?: AbortSignal },
  ): AsyncIterable<LangGraphStreamEvent>;
}

export interface LangGraphStreamEvent {
  event: string;
  name?: string;
  run_id?: string;
  data?: {
    chunk?: unknown;
    output?: unknown;
    input?: unknown;
  };
}

export interface LangGraphHandlerOptions {
  /**
   * A compiled LangGraph graph (e.g. `createReactAgent({...})`) — any object
   * exposing a `streamEvents(input, { version, signal })` method works.
   */
  graph: StreamableGraph;
  /** Surfaced on the `message_start` event. */
  model?: string;
  /**
   * Construct the graph input from the Sharely AgentInput. Default uses the
   * common LangChain `messages` shape; override if your graph expects
   * something different.
   */
  buildInput?: (input: AgentInput) => unknown;
}

const defaultBuildInput = (input: AgentInput): unknown => ({
  messages: [
    ...input.history.map(m => ({ role: m.role, content: m.content ?? '' })),
    { role: 'user', content: input.message },
  ],
});

export const createLangGraphHandler = (
  opts: LangGraphHandlerOptions,
): Handler => {
  const { graph, model, buildInput = defaultBuildInput } = opts;

  return async function* (input: AgentInput): AsyncIterable<AgentEvent> {
    yield {
      type: 'message_start',
      role: 'assistant',
      model: model ?? 'langgraph',
    };

    const collectedSources: Source[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    const finishReason = 'stop';

    try {
      const stream = graph.streamEvents(buildInput(input), {
        version: 'v2',
        signal: input.signal,
      });

      for await (const event of stream) {
        if (input.signal.aborted) return;

        if (event.event === 'on_chat_model_stream') {
          const delta = extractTextContent(event.data?.chunk);
          if (delta) yield { type: 'content_delta', delta };
        } else if (event.event === 'on_chat_model_end') {
          const usage = extractUsage(event.data?.output);
          inputTokens += usage.input;
          outputTokens += usage.output;
        } else if (event.event === 'on_tool_start') {
          yield {
            type: 'tool_call_start',
            toolCallId: pickToolCallId(event),
            name: pickToolName(event),
            input: extractToolInput(event.data?.input),
          };
        } else if (event.event === 'on_tool_end') {
          const output = event.data?.output;
          if (output && typeof output === 'object' && 'sources' in output) {
            const ss = (output as { sources?: Source[] }).sources;
            if (Array.isArray(ss)) collectedSources.push(...ss);
          }
          yield {
            type: 'tool_call_end',
            toolCallId: pickToolCallId(event),
            output,
            durationMs: 0,
          };
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
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

// ---------- Extractors ----------
// LangGraph's streamEvents shapes are stable, but AIMessageChunk content can
// be a plain string OR an array of content blocks (multi-modal / thinking).

const extractTextContent = (chunk: unknown): string => {
  if (!chunk || typeof chunk !== 'object') return '';
  const content = (chunk as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        c =>
          c &&
          typeof c === 'object' &&
          (c as { type?: string }).type === 'text',
      )
      .map(c => (c as { text?: string }).text ?? '')
      .join('');
  }
  return '';
};

const extractUsage = (output: unknown): { input: number; output: number } => {
  if (!output || typeof output !== 'object') return { input: 0, output: 0 };
  const meta = (
    output as {
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
    }
  ).usage_metadata;
  return {
    input: meta?.input_tokens ?? 0,
    output: meta?.output_tokens ?? 0,
  };
};

const extractToolInput = (raw: unknown): Record<string, unknown> => {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    // LangChain occasionally wraps as { input: {...} }
    const inner = (raw as { input?: unknown }).input;
    if (inner && typeof inner === 'object') {
      return inner as Record<string, unknown>;
    }
    return raw as Record<string, unknown>;
  }
  return {};
};

const pickToolCallId = (event: { run_id?: string }): string => {
  if (typeof event.run_id === 'string' && event.run_id) return event.run_id;
  throw new Error(
    'LangGraph handler: tool event missing run_id — streamEvents version drifted. Update pickToolCallId.',
  );
};

const pickToolName = (event: { name?: string }): string => {
  if (typeof event.name === 'string' && event.name) return event.name;
  throw new Error(
    'LangGraph handler: tool event missing name — streamEvents version drifted. Update pickToolName.',
  );
};
