# live-demo-temporal

A runnable Sharely agent server backed by a **Temporal workflow**, using only
[`@sharelyai/adapter-temporal`](../../packages/adapter-temporal/) — no LLM SDK.
This is the Temporal counterpart to [`live-demo-vercel`](../live-demo-vercel/):
same `createSharelyServer` front door, same `get_weather` tool, but the agent
runs as a durable Temporal workflow instead of an inline Vercel AI stream.

Use this shape when you want **durable, retryable, observable** agent runs —
long tool calls, queue-backed execution, replayable history.

## How it's split (two processes)

Unlike the Vercel demo (one process), a Temporal agent has two sides that talk
over a Temporal server:

| Process    | File                                 | Role                                                                                                                               |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Server** | [`server.ts`](src/server.ts)         | The Sharely agent server. `createSharelyServer` + `createTemporalHandler` (over `fromTemporal`). Starts a workflow per chat turn and polls its event-buffer query, streaming the events back as SSE. |
|            | [`handler.ts`](src/handler.ts)       | `createTemporalHandler` + `wrapTemporalClient` — adapts the real `@temporalio/client` `Client` to the adapter's structural shape.   |
| **Worker** | [`worker.ts`](src/worker.ts)         | Registers the workflow + activities and polls the task queue.                                                                       |
|            | [`workflow.ts`](src/workflow.ts)     | Deterministic workflow. Exposes the adapter's `AGENT_EVENTS_QUERY` sink, delegates work to the `runAgent` activity, relays its `AgentEvent`s into the sink. |
|            | [`activities.ts`](src/activities.ts) | The raw LLM tool-calling loop (`fetch` against OpenAI Chat Completions) with the `get_weather` tool. Returns `AgentEvent[]`.        |

### Request flow

```
sharelyai-be ──▶ server.ts (createSharelyServer)
                    │  fromTemporal: client.start(sharelyAgentWorkflow)
                    ▼
              Temporal server ──▶ worker.ts ──▶ workflow.ts
                    │                               │ proxyActivities → runAgent
                    │                               ▼
                    │                          activities.ts  (fetch → OpenAI + get_weather)
                    │                               │ returns AgentEvent[]
                    │              emitAgentEvent ◀─┘  into createAgentEventSink()
                    ▼
              server polls AGENT_EVENTS_QUERY until message_end → SSE → sharelyai-be
```

## Run it

You need a Temporal server, a worker, and the agent server — three terminals.

```bash
# 0. install + build (from repo root)
npm install
npx turbo run build

# 1. Temporal dev server (install the CLI: https://docs.temporal.io/cli)
temporal server start-dev          # serves :7233, UI on :8233

# 2. configure env
cd apps/live-demo-temporal
cp .env.example .env               # fill in SHARELY_* and OPENAI_API_KEY

# 3. the worker (compiles, then runs under plain node — see note below)
npm run dev:worker

# 4. the agent server
npm run dev                        # listens on :8082
```

Then point a Sharely thread's `agentServerId` at `http://localhost:8082` and
chat. Try "what's the weather in Berlin?" to exercise the tool loop.

For production, `npm run build` once, then `npm start` (server) and
`npm run start:worker` (worker).

## Design notes

- **Raw, adapter-only.** The agent is built with just `@sharelyai/adapter-temporal`'s
  `createAgentEventSink` / `emitAgentEvent` and a hand-rolled OpenAI `fetch`
  loop. No Vercel AI SDK, no LLM SDK — the AgentEvents are emitted directly.

- **The LLM call lives in an activity, not the workflow.** Workflows are
  deterministic and can't do I/O, so the `fetch` to OpenAI runs in the
  `runAgent` activity. That's also what makes the turn durable: if the worker
  crashes mid-call, Temporal retries the activity. The workflow only orchestrates
  and relays events into the sink.

- **Turn-level durability, not token-level streaming.** The activity runs the
  whole tool loop and returns the full `AgentEvent[]` at once; the workflow then
  emits them and the next client poll drains them. So the user sees the reply in
  one batch rather than token-by-token. True mid-call streaming would need
  Temporal Updates/heartbeated activity progress — out of scope for this demo.

- **First-party Sharely tools aren't available inside the workflow.** The
  adapter passes only a *serializable* slice of `AgentContext` into the workflow
  (workspaceId, threadId, userId, roleId, …) — **not** `authorization` or the
  `api` client. The platform tools (`semantic_search`, `search_knowledge`, …)
  dispatch through `context.api`, which doesn't exist on the worker side, so this
  demo uses only the self-contained `get_weather` tool. To use platform tools in
  a Temporal agent you'd forward an auth token into the workflow input and
  rebuild an API client inside the activity.

- **The worker runs under plain `node`, not `tsx`.** Temporal bundles the
  workflow with webpack, and `tsx`'s loader hook breaks webpack's internal module
  resolution. So `dev:worker` compiles with `tsc` first and runs `dist/worker.js`.
  The server side has no bundler and runs fine under `tsx` (`npm run dev`).

## Env vars

| Var                         | Used by       | Notes                                            |
| --------------------------- | ------------- | ------------------------------------------------ |
| `SHARELY_API_URL`           | server        | sharelyai-be base URL                            |
| `SHARELY_WORKSPACE_ID`      | server        | your workspace id                                |
| `SHARELY_WORKSPACE_API_KEY` | server        | workspace access-key token                       |
| `OPENAI_API_KEY`            | worker        | for the activity's OpenAI calls                  |
| `OPENAI_MODEL`              | worker        | defaults to `gpt-5.4-mini`                       |
| `TEMPORAL_ADDRESS`          | server+worker | defaults to `localhost:7233`                     |
| `TEMPORAL_NAMESPACE`        | server+worker | defaults to `default`                            |
| `TEMPORAL_TASK_QUEUE`       | server+worker | defaults to `sharely-agents` (must match)        |
| `PORT`                      | server        | defaults to `8082`                               |
