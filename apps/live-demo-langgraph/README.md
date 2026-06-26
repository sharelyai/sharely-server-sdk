# live-demo-langgraph

A runnable Sharely agent server backed by a **LangGraph** graph. Same shape as
[`live-demo-vercel`](../live-demo-vercel/) — one process, `createSharelyServer`,
the `get_weather` tool, OpenAI `gpt-5.4-mini` — but the agent loop is a
`createReactAgent` graph and the handler **observes** its `streamEvents`.

LangGraph is **Pattern C**: it has no `@sharelyai/adapter-*` package. The
framework owns the loop and tool execution; the translator from LangGraph's
event stream to Sharely `AgentEvent`s lives in this app
([`src/handler.ts`](src/handler.ts) — the customer-form code you'd copy).

Reach for this shape when you want LangGraph's graph composition — multi-node
agents, conditional edges, checkpointing, human-in-the-loop — surfaced as a
Sharely-compatible server.

## Files

| File                           | Purpose                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`server.ts`](src/server.ts)   | Builds a `createReactAgent` graph (`ChatOpenAI` + the `get_weather` tool) and wires `createLangGraphHandler` into `createSharelyServer`. |
| [`handler.ts`](src/handler.ts) | `createLangGraphHandler({ graph, model, buildInput })` — the `streamEvents` → `AgentEvent` mapping. **The part that matters.**            |

## Run it

```bash
# from repo root
npm install
npx turbo run build

cd apps/live-demo-langgraph
cp .env.example .env        # fill SHARELY_* and OPENAI_API_KEY
npm run dev                 # listens on :8083
```

The server now listens on `http://localhost:8083`. The last step is to connect
your workspace to it — see [Configure it in your workspace](#configure-it-in-your-workspace)
below — then ask *"what's the weather in Berlin?"* to exercise the tool loop. For
production: `npm run build` then `npm start`.

## Configure it in your workspace

With the server running and reachable over HTTPS, point your Sharely workspace at
it. The chat in your **WebControl** then routes every conversation to this server.

**1. Open Settings → Agent server.** In your workspace, go to **Settings** in the
left sidebar and open the **Agent server** tab.

![Open the Agent server tab in Settings](../../images/settings.png)

**2. Add your server URL and save.** Paste your agent server's public URL into
**Server URL** and click **Save configuration**.

![Enter your agent server URL and save](../../images/settings-2.png)

**3. Chat with your agent in WebControl.** Open **Agent chat** in your WebControl —
every message now goes to your server, and its replies, tool calls, and steps
stream back in live.

![Your agent responding in WebControl's Agent chat](../../images/webcontrol.png)

> **Reachability.** The URL must be reachable by Sharely over HTTPS. In production
> use your deployed URL (e.g. `https://my-company.com/agent-server`). For local
> development, expose your localhost with a tunnel — e.g. `ngrok http 8083` — and
> paste the resulting `https://…` URL.

## What the handler maps

`graph.streamEvents(input, { version: 'v2', signal })` →

- `on_chat_model_stream` → `content_delta` (text extracted from `chunk.content`, string or content-block array)
- `on_chat_model_end` → accumulates `inputTokens` / `outputTokens` from `usage_metadata`
- `on_tool_start` → `tool_call_start` (`run_id` as `toolCallId`, `name` as the tool name)
- `on_tool_end` → `tool_call_end`; if the tool output carries a `sources` array it's accumulated and emitted as one batched `sources` event before `content_end`

Then `sources` (if any) → `content_end` → `message_end` with summed usage.
`input.signal` (client disconnect) is passed straight into `streamEvents` and
honored natively by LangGraph.

## Notes

- **OpenAI to match the sibling demos.** The langgraph *example* under
  [`examples/langgraph`](../../examples/langgraph/) uses `@langchain/anthropic`;
  this app uses `@langchain/openai` + `gpt-5.4-mini` so all three live demos
  share the same `OPENAI_API_KEY` / model. Swap `ChatOpenAI` for any LangChain
  chat model.

- **Sources are by convention.** Nothing in LangGraph marks citations. Have a
  tool return `{ ..., sources }` and the handler batches them into a `sources`
  event. `get_weather` doesn't return sources, so this demo emits none — see the
  example's `lookup` tool for the pattern.

- **Reasoning / chain / retriever events are ignored.** `on_chain_*`,
  `on_retriever_*`, and `{ type: 'thinking' }` content blocks aren't surfaced.
  Add branches in `handler.ts` to map them to `thinking_*` or `sources` events.

- **Persistence is the server's job.** `@sharelyai/server` stores history in
  `agentMessage` and invokes the handler per turn with it. For LangGraph's own
  per-graph state, configure a `checkpointer` with `thread_id: input.context.threadId`.

## Env vars

| Var                         | Notes                                            |
| --------------------------- | ------------------------------------------------ |
| `SHARELY_API_URL`           | sharelyai-be base URL                            |
| `SHARELY_WORKSPACE_ID`      | your workspace id                                |
| `SHARELY_WORKSPACE_API_KEY` | workspace access-key token                       |
| `OPENAI_API_KEY`            | read by `@langchain/openai`                      |
| `OPENAI_MODEL`              | defaults to `gpt-5.4-mini`                        |
| `PORT`                      | defaults to `8083`                               |
