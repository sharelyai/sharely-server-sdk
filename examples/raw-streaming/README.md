# Pattern C — raw streaming

The most minimal Pattern C: no framework, no factory, no wrapper. **A `Handler` is just an async generator that yields `AgentEvent`s.** Copy this, replace the `runLLMTurn` / `runTool` stubs with your real LLM and tool implementations.

## Files

| File                         | Purpose                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handler.ts`](./handler.ts) | The `rawHandler` itself — a multi-turn agent loop (model → tool → model → answer) showing every event type you'd typically emit. **Read this**. |
| [`server.ts`](./server.ts)   | Two lines: import the handler, pass it to `createSharelyServer`.                                                                                |
| [`smoke.mjs`](./smoke.mjs)   | Runnable proof. JS port of the handler + 10 assertions (no fake client needed).                                                                 |

`handler.ts` is the customer-form code. `smoke.mjs` inlines the same logic in JS so the example runs without a TypeScript build — if you change one, mirror it in the other.

## Run the smoke

```bash
npm install
npx turbo run build --filter=@sharely/conformance
node examples/raw-streaming/smoke.mjs
```

Expected: `all checks passed`.

## When to use this pattern

Reach for raw when:

- You have a **non-streaming LLM** and want to chunk the final string into deltas.
- You're **bridging a custom upstream protocol** (your own HTTP SSE, a WebSocket, a queue) into Sharely's wire format.
- You've built a **hand-rolled multi-step agent** (your own loop, your own tool routing) and don't want a framework abstraction in the way.
- You want the **absolute minimum** to satisfy the Handler contract — useful as a learning baseline.

If you're using an off-the-shelf framework, reach for the matching example ([anthropic-sdk-direct](../anthropic-sdk-direct/), [openai-agents-sdk](../openai-agents-sdk/), [langgraph](../langgraph/)) or [`@sharelyai/adapter-vercel-ai`](../../packages/adapter-vercel-ai/) first.

## The Handler contract

```ts
type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;
```

`input` carries `message`, `history`, `context` (workspaceId, threadId, api client, trace), and a `signal: AbortSignal`. You yield discriminated `AgentEvent` objects; `@sharelyai/server` handles SSE framing, the `threadId` / `messageId` envelope, persistence to `agentMessage`, and the trailing `done` event.

## What this example demonstrates

The handler implements a real two-iteration loop. Turn 0: the LLM stub thinks, streams an opener, and emits a `lookup` tool call. The handler runs the tool. Turn 1: the LLM stub uses the tool's output to produce the final answer.

Per turn, you see:

1. `runLLMTurn(input, lastToolOutput, iter)` — your model call. Returns thinking, text, optional `toolCall`, and per-turn `usage`.
2. `thinking_*` events if the model produced thinking.
3. `content_delta`s as the answer text streams (honors `input.signal` between yields).
4. If a tool was requested: `tool_call_start` → `runTool(...)` → `tool_call_end`. The loop continues to the next iteration with `lastToolOutput` fed back to the model.
5. If no tool call: break, emit batched `sources`, then `content_end` and `message_end` with the **summed** token usage across all turns.

The minimum valid stream is `message_start` → some content → `content_end` → `message_end`. Trim sections you don't need.

## Tool input is whole on `tool_call_start`

The protocol has no partial-input event — `tool_call_start` carries the fully-parsed input. If your upstream LLM streams arguments as JSON fragments (e.g. Anthropic's `input_json_delta`, OpenAI's argument streaming), buffer them in your `runLLMTurn` and yield `tool_call_start` only when the call closes. See [anthropic-sdk-direct](../anthropic-sdk-direct/) for the buffer-then-emit pattern in context.

## Sources

The handler treats each tool result as `{ output, sources }` and accumulates `sources` across every iteration, emitting one batched `sources` event before `content_end`. The `output` is what you'd feed back to the model on the next iteration; the `sources` event drives the UI's citation rendering.

## Cancellation

The handler checks `input.signal.aborted` inside the chunked content loop and returns early. **Check `input.signal` between every long-running step in your real handler** (model calls, tool calls, HTTP requests) so client disconnects propagate quickly. Pass the signal through to any upstream `fetch`, model SDK call, or DB query that supports it.
