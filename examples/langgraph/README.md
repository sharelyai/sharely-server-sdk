# Pattern C — LangGraph

A raw Sharely `Handler` driving a [LangGraph](https://langchain-ai.github.io/langgraphjs/) graph via `streamEvents`. Like the [openai-agents-sdk example](../openai-agents-sdk/), the framework owns the agent loop and tool execution; this handler **observes** the event stream and translates events to `AgentEvent`s.

## Files

| File                         | Purpose                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`handler.ts`](./handler.ts) | `createLangGraphHandler({ graph, model, buildInput })`. The event mapping. **Read this**.                        |
| [`server.ts`](./server.ts)   | Builds a `createReactAgent` graph (Anthropic model + one `lookup` tool) and wires it into `createSharelyServer`. |
| [`smoke.mjs`](./smoke.mjs)   | Runnable proof. JS port of the handler + a fake graph + assertions. No API key needed.                           |

`handler.ts` is the customer-form code. `smoke.mjs` inlines the same logic in JS so the example runs without TypeScript or LangChain deps — if you change one, mirror it in the other.

## Run the smoke

```bash
npm install
npx turbo run build --filter=@sharelyai/conformance
node examples/langgraph/smoke.mjs
```

Expected: `all checks passed`.

## When to use this pattern

Reach for this when you want LangGraph's **graph composition** — multi-node agents, conditional edges, checkpointing, human-in-the-loop, the `createReactAgent` prebuilt — but still want to surface the result as a Sharely-compatible server.

If you only need a simple text-streaming chat (no graph nodes, no tools), the [`@sharelyai/adapter-vercel-ai`](../../packages/adapter-vercel-ai/) is lighter weight.

## What the handler does

1. Yields `message_start` with the configured model.
2. Calls `graph.streamEvents(buildInput(input), { version: 'v2', signal: input.signal })`.
3. Iterates the stream and maps:
   - `on_chat_model_stream` → `content_delta` (extracts text from `event.data.chunk.content`, which can be a string or an array of content blocks)
   - `on_chat_model_end` → bumps `inputTokens` / `outputTokens` from `event.data.output.usage_metadata`
   - `on_tool_start` → `tool_call_start` (uses `event.run_id` as `toolCallId`, `event.name` as the tool name)
   - `on_tool_end` → `tool_call_end`; if the tool's `output` carries a `sources` array, those are accumulated for the final batched `sources` event
4. After the stream completes, yields `sources` (if any), `content_end`, and `message_end` with summed usage.

## Cancellation

`graph.streamEvents(input, { signal })` is honored natively — LangGraph propagates the signal to the underlying model + tool calls. Client disconnects via `input.signal` flow through cleanly.

## Sources (by convention)

LangGraph tools return whatever you want; nothing in the framework distinguishes citations. Convention: have your tool return `{ ..., sources }`. The handler inspects `on_tool_end.data.output`, pulls any `sources` array, and emits one batched `sources` event before `content_end`.

The reference [`lookup`](./server.ts) tool does this. The `sources` field is also sent back to the LLM along with the rest of the output — the model usually ignores it.

## Input shape

By default the handler builds:

```ts
{
  messages: [...history, { role: 'user', content: message }];
}
```

which is what `createReactAgent` (and most LangGraph chat-style graphs) expects. If your graph takes a different shape, pass a `buildInput`:

```ts
createLangGraphHandler({
  graph,
  buildInput: input => ({ question: input.message, context: input.history }),
});
```

## Not covered

**Chain / retriever / RAG events.** `on_chain_*`, `on_retriever_*`, `on_prompt_*` are ignored. If you want to surface retrieval steps as `thinking_*` blocks, add a branch for `on_retriever_end` and emit `sources` from the retrieved documents.

**Reasoning chunks.** If your chat model emits reasoning (e.g. Claude extended thinking), the `chunk.content` array will include `{ type: 'thinking' }` blocks. `extractTextContent` skips those — add a branch if you want to surface them as Sharely `thinking_*` events.

**Multi-turn checkpointing.** LangGraph supports persisting state across turns via `checkpointer`. The handler doesn't manage that — `@sharelyai/server` is the persistence layer (it stores message history in `agentMessage`), and the handler is invoked per-turn with that history. If you also want LangGraph's per-graph state to persist, configure a checkpointer on the graph itself with `thread_id: input.context.threadId`.
