# Pattern C — OpenAI Agents SDK

A raw Sharely `Handler` driving [`@openai/agents`](https://openai.github.io/openai-agents-js/). The SDK owns the agent loop and tool execution; this handler **observes** the run and translates events to `AgentEvent`s.

## Files

| File | Purpose |
|---|---|
| [`handler.ts`](./handler.ts) | `createOpenAIAgentsHandler({ agent, model, maxTurns })`. The event mapping. **Read this**. |
| [`server.ts`](./server.ts) | Wires an `Agent` (with one `lookup` tool) into `createSharelyServer`. |
| [`smoke.mjs`](./smoke.mjs) | Runnable proof. JS port of the handler + a fake `run()` + assertions. No API key needed. |

`handler.ts` is the customer-form code. `smoke.mjs` inlines the same logic in JS so the example runs without TypeScript or external deps — if you change one, mirror it in the other.

## Run the smoke

```bash
npm install
npx turbo run build --filter=@sharely/conformance
node examples/openai-agents-sdk/smoke.mjs
```

Expected: `all checks passed`.

## When to use this pattern

Reach for this when you want the **Agents SDK's higher-level abstractions** — agent definitions, handoffs between agents, the built-in tool-calling loop, OpenAI's Responses API event shapes — but still want to surface the result as a Sharely-compatible server.

Compared to the [anthropic-sdk-direct example](../anthropic-sdk-direct/): there the handler owns the loop and executes tools itself; here the SDK owns both and the handler is a translator.

## What the handler does

1. Yields `message_start` with the configured model.
2. Calls `run(agent, runnerInput, { stream: true })` — the SDK runs the entire agent loop (model calls + tool executions + handoffs) and emits a single event stream.
3. Iterates the stream and maps:
   - `raw_model_stream_event` with `data.type === 'response.output_text.delta'` → `content_delta`
   - `raw_model_stream_event` with `data.type === 'response.completed'` → bumps `inputTokens` / `outputTokens` from `data.response.usage`
   - `run_item_stream_event` with `name === 'tool_called'` → `tool_call_start` (id/name/input pulled defensively from a few common item locations — the Agents SDK item shape varies by version)
   - `run_item_stream_event` with `name === 'tool_output'` → `tool_call_end`; if the tool's `output` carries a `sources` array, those are accumulated for the final batched `sources` event
4. After the stream completes, yields `sources` (if any), `content_end`, and `message_end` with summed token usage.

## Cancellation

The Agents SDK doesn't (in every version) take an `AbortSignal` on `run()`. The handler bridges `input.signal` → `stream.abort()` so client disconnects halt the in-flight model + tool calls. If your SDK version exposes a signal option, pass it through `run()` too.

## Sources (by convention)

The SDK doesn't have a native source concept, so the convention is: have your tools return `{ output, sources }`. The handler inspects `tool_output.item.output`, pulls any `sources` array, and emits one batched `sources` event before `content_end`. The reference [`lookup`](./server.ts) tool does exactly this.

```ts
tool({
  name: 'lookup',
  description: '...',
  parameters: z.object({ q: z.string() }),
  execute: async ({ q }) => ({
    output: { answer: 42 },
    sources: [{ id: 'src-1', type: 'knowledge', title: 'Doc', url: '...' }],
  }),
});
```

## Not covered

**Handoffs.** `agent_updated_stream_event` is ignored. If your UI needs to know when one agent hands off to another, emit a custom event (or a synthetic `thinking_*` block) in the `agent_updated_stream_event` branch.

**Reasoning / thinking deltas.** OpenAI's Responses API emits `response.reasoning_summary_text.delta` for reasoning models. Map those to `thinking_*` if you use o-series models — same shape as the `text_delta` branch.

**Item-shape drift.** The defensive accessors (`pickToolCallId` / `pickToolName` / `pickToolInput`) read a few common locations because the `item` shape on `run_item_stream_event` has changed across SDK versions. Pin a version and tighten if you care.
