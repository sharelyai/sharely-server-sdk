# Pattern C — Anthropic SDK direct

A raw Sharely `Handler` driving `@anthropic-ai/sdk` directly: streams text and thinking, executes tools across a multi-turn loop, and yields `AgentEvent`s for the server to encode and persist.

## Files

| File | Purpose |
|---|---|
| [`handler.ts`](./handler.ts) | `createAnthropicHandler({ client, model, tools, ... })`. The protocol mapping — **read this**. |
| [`server.ts`](./server.ts) | Wires the handler into `createSharelyServer`. Drop-in shape for a customer server. |
| [`smoke.mjs`](./smoke.mjs) | Runnable proof. JS port of the handler + a fake Anthropic client + assertions. No API key needed. |

`handler.ts` is the customer-form code. `smoke.mjs` inlines the same logic in JS so this example runs without TypeScript or external deps — if you change one, mirror it in the other.

## Run the smoke

```bash
npm install
npx turbo run build --filter=@sharely/conformance
node examples/anthropic-sdk-direct/smoke.mjs
```

Expected: `all checks passed`.

## When to use this pattern

Reach for Pattern C when you want **direct control over the Anthropic loop** — custom retry, custom stop conditions, prompt caching tuned to your prompt shape, or you already have an Anthropic-based agent and want to surface it as a Sharely server.

If you don't need that control, prefer [`@sharely/adapter-vercel-ai`](../../packages/adapter-vercel-ai/) — same wire output via `streamText`, less plumbing.

## What the handler does

1. Yields `message_start` with the configured model.
2. Per iteration (up to `maxIterations`, default 10):
   - Calls `client.messages.stream({ ..., signal: input.signal })`.
   - Streams `text_delta` → `content_delta`, `thinking_delta` → `thinking_*`.
   - For each `tool_use` block: buffers `input_json_delta` chunks; when the block closes, parses the assembled JSON and yields `tool_call_start` **immediately** (mid-stream, interleaved with surrounding text).
   - When the whole stream ends, executes every tool that was started and yields `tool_call_end` for each. Any `sources` the executor returns are pushed into a per-turn accumulator.
   - If no tools were called, breaks the loop. Otherwise pushes tool results back into `messages` and iterates.
3. If the accumulator has any sources, yields a single batched `sources` event.
4. Yields `content_end`, then `message_end` with aggregated `inputTokens` / `outputTokens` / `totalTokens` summed across every iteration.

`input.signal.aborted` is checked between events so a client disconnect propagates to the upstream Anthropic HTTP request.

## Sources

Tool executors return the Sharely [`ToolResult`](../../packages/protocol/src/tools.ts) shape: `{ output?, error?, sources? }`. `output` is JSON-serialized back to Anthropic (so Claude sees what the tool found); `sources` is collected across every tool call in every iteration and emitted as **one batched `sources` event** just before `content_end`. This matches Sharely's hosted [`runAgentLoop`](../../README.md#5-changes-already-made-in-sharelyai-be-cross-repo) — sources are plural, batched, and ordered last so the UI can render citations alongside the final answer.

```ts
tools: [{
  name: "lookup",
  description: "...",
  input_schema: { /* ... */ },
  execute: async ({ q }) => ({
    output: { answer: 42 },
    sources: [{ id: "src-1", type: "knowledge", title: "Doc", url: "..." }]
  })
}]
```

## Tool input streaming

The tool's input arrives from Anthropic as a sequence of `input_json_delta` chunks (partial JSON fragments). The handler buffers those per-block, and at `content_block_stop` parses the assembled JSON and yields `tool_call_start` with the full input — **without** waiting for the rest of the stream to finish.

The visible effect: in a turn that emits `text → tool_use → text`, the UI sees:

```
content_delta  "Let me check. "
tool_call_start  lookup(q="x")        ← fires here, mid-stream
content_delta  "Looking now..."
tool_call_end                          ← after stream ends + tool executes
```

Tool **execution** still happens after the stream ends (atomic, no race with subsequent stream events). The protocol has no streamed-partial-input event, so the input lands once on `tool_call_start` rather than typing-in character by character — but the *start* event itself lands as early as the protocol allows.

If a future protocol revision adds a `tool_call_input_delta` event, swap the per-block buffer for a yield-per-chunk in `content_block_delta`.
