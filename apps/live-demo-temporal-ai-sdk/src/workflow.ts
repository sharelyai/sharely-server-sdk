// The workflow runs in Temporal's deterministic sandbox — but unlike the sibling
// `live-demo-temporal`, the agentic loop lives HERE, not in an activity. This is
// the Temporal AI SDK integration:
//
//   https://docs.temporal.io/develop/typescript/integrations/ai-sdk
//
// We call the Vercel AI SDK's `generateText` directly inside the workflow, with
// the model resolved via `temporalProvider.languageModel(...)`. The AiSdkPlugin
// (registered on the worker — see worker.ts) transparently turns every LLM call
// into a Temporal activity, so each model turn is durable and retryable without
// us hand-rolling a `fetch` loop. Tools are ordinary `proxyActivities`, so each
// tool call is its own retryable activity too.
//
// The deterministic, sandbox-safe parts (`generateText`, `tool`, the provider
// shim) run in the workflow; the non-deterministic LLM/tool I/O is delegated to
// activities by the plugin. The workflow still exposes the adapter's
// `AGENT_EVENTS_QUERY` sink so the server can poll AgentEvents and stream SSE.
//
// `import type` for the activities keeps their Node-only code out of the
// workflow bundle — only the function *types* are referenced for `proxyActivities`.

// MUST be the first import: it installs the web-stream / Headers / structuredClone
// polyfills into the Temporal workflow sandbox *before* `ai` is evaluated. The AI
// SDK's module graph (eventsource-parser → @ai-sdk/provider-utils) references
// `TransformStream` at load time, which the sandbox doesn't provide by default —
// without this the worker throws `ReferenceError: TransformStream is not defined`
// while bundling/activating the workflow.
import '@temporalio/ai-sdk/lib/load-polyfills.js';
import {
  proxyActivities,
  defineQuery,
  setHandler,
  CancellationScope,
  isCancellation,
} from '@temporalio/workflow';
import { generateText, tool, stepCountIs, ModelMessage } from 'ai';
import { temporalProvider } from '@temporalio/ai-sdk';
import { z } from 'zod';
import {
  AGENT_EVENTS_QUERY,
  createAgentEventSink,
  emitAgentEvent,
} from '@sharelyai/adapter-temporal';
import type { AgentEvent } from '@sharelyai/protocol';
import type * as activities from './activities.js';
import { LanguageModelV3 } from '@ai-sdk/provider';

// The model id is chosen in the workflow (it's serialized to the plugin's LLM
// activity, where the worker's configured provider builds the real model).
// Workflows can't read process.env deterministically, so this is a constant —
// change it here, or thread it through WorkflowInput, to use a different model.
const MODEL = 'gpt-5.4-mini';
const MAX_STEPS = 8;

const { getWeather } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/** Shallow read-view of an AI SDK step — see the translation loop below. */
interface StepView {
  text?: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown }>;
  toolResults?: Array<{ toolCallId: string; output?: unknown }>;
}

/** Shallow read-view of the `generateText` result (see `generate` below). */
interface GenerateResultView {
  steps: StepView[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

// `generateText`'s fully-inferred return type (`GenerateTextResult<…>`) is deep
// enough that resolving its members trips TS2589 / exhausts the type-checker's
// heap. We only read a shallow slice of it, so call it through an alias whose
// return type is the flat `GenerateResultView`. This is a *type-only* cast — at
// runtime `generate` is exactly `generateText`.
const generate = generateText as (opts: {
  model: LanguageModelV3;
  system?: string;
  messages: ModelMessage[];
  tools?: unknown;
  stopWhen?: unknown;
}) => Promise<GenerateResultView>;

// `tool()`'s schema-driven generic inference likewise trips TS2589, so call it
// through a loose alias. The `execute` argument is typed explicitly instead of
// being inferred from `inputSchema`. Type-only cast — `makeTool` === `tool`.
const makeTool = tool as (def: {
  description?: string;
  inputSchema: unknown;
  execute: (input: { city: string }) => Promise<unknown>;
}) => unknown;

const SYSTEM_PROMPT =
  'You are a helpful Sharely agent running inside a durable Temporal workflow. ' +
  'Use get_weather for weather or temperature questions. After a tool returns, ' +
  'summarize the result for the user in natural language.';

export const sharelyAiSdkAgentWorkflow = async (
  input: activities.WorkflowInput,
): Promise<void> => {
  const sink = createAgentEventSink();
  setHandler(
    defineQuery<
      { events: AgentEvent[]; done: boolean; cursor?: number },
      [number]
    >(AGENT_EVENTS_QUERY),
    sink.query,
  );

  emitAgentEvent(sink, {
    type: 'message_start',
    role: 'assistant',
    model: MODEL,
  });

  // Built via the `makeTool`/`generate` aliases above so the AI SDK's deep
  // generics don't blow up the type-checker. At runtime this is a normal
  // `tool()` + `generateText` call.
  const tools = {
    get_weather: makeTool({
      description:
        'Get the current weather for a city. Use this when the user asks ' +
        'about weather or temperature in a specific location.',
      inputSchema: z.object({
        city: z.string().describe('City name, e.g. "Berlin"'),
      }),
      // Each tool call runs as its own durable Temporal activity.
      execute: async ({ city }) => getWeather({ city }),
    }),
  };

  try {
    const result = await generate({
      model: temporalProvider.languageModel(MODEL),
      system: SYSTEM_PROMPT,
      messages: [
        ...input.history.map(m => ({
          role: m.role,
          content: m.content ?? '',
        })),
        { role: 'user', content: input.message },
      ],
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    // Translate the AI SDK result into Sharely AgentEvents. Each step is one
    // model turn; within a step the tool calls fire before the model's text, so
    // we emit tool_call_start/end first, then any assistant text.
    for (const step of result.steps) {
      for (const call of step.toolCalls ?? []) {
        emitAgentEvent(sink, {
          type: 'tool_call_start',
          toolCallId: call.toolCallId,
          name: call.toolName,
          input: (call.input ?? {}) as Record<string, unknown>,
        });
      }
      for (const res of step.toolResults ?? []) {
        emitAgentEvent(sink, {
          type: 'tool_call_end',
          toolCallId: res.toolCallId,
          output: res.output,
          // The AI SDK doesn't surface per-tool wall time; the real timing lives
          // in the Temporal activity history.
          durationMs: 0,
        });
      }
      if (step.text) {
        emitAgentEvent(sink, { type: 'content_delta', delta: step.text });
      }
    }

    emitAgentEvent(sink, { type: 'content_end' });
    emitAgentEvent(sink, {
      type: 'message_end',
      finishReason: result.finishReason ?? 'stop',
      tokenUsage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
      },
    });
  } catch (err) {
    if (isCancellation(err)) {
      // Client disconnected → workflow cancelled. Nothing is polling anymore;
      // just close the buffer (in a non-cancellable scope) and re-raise so
      // Temporal records the run as cancelled.
      await CancellationScope.nonCancellable(async () => sink.complete());
      throw err;
    }
    emitAgentEvent(sink, {
      type: 'error',
      error: err instanceof Error ? err.message : 'workflow failed',
    });
  } finally {
    sink.complete();
  }
};
