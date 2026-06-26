# live-demo-vercel

A runnable Sharely agent server backed by the **Vercel AI SDK**, using
[`@sharelyai/adapter-vercel-ai`](../../packages/adapter-vercel-ai/). One process,
`createSharelyServer`, OpenAI `gpt-5.4-mini`, the first-party Sharely knowledge
tools, plus a sample `get_weather` tool.

This is the **simplest** live demo and the recommended starting point — the agent
loop is a single inline `streamText` call, with no worker, queue, or graph to run.
Reach for [`live-demo-temporal`](../live-demo-temporal/) or
[`live-demo-temporal-ai-sdk`](../live-demo-temporal-ai-sdk/) when you want durable,
retryable runs, or [`live-demo-langgraph`](../live-demo-langgraph/) for graph
composition.

## Files

| File                           | Purpose                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`server.ts`](src/server.ts)   | Reads env, wires `handler` into `createSharelyServer`, and listens on `:8081`. Installs graceful shutdown.                               |
| [`handler.ts`](src/handler.ts) | `fromVercelAI(input => streamText({...}))` — the agent itself. Registers the Sharely knowledge tools + a custom `get_weather` tool. **The part you'd copy.** |

## Run it

```bash
# from repo root
npm install
npx turbo run build

cd apps/live-demo-vercel
cp .env.example .env        # fill SHARELY_* and OPENAI_API_KEY
npm run dev                 # listens on :8081
```

`SHARELY_WORKSPACE_ID` and `SHARELY_WORKSPACE_API_KEY` come from your Sharely
workspace (**Settings → API Keys**); `OPENAI_API_KEY` is your own OpenAI key.

The server now listens on `http://localhost:8081`. The last step is to connect
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
> development, expose your localhost with a tunnel — e.g. `ngrok http 8081` — and
> paste the resulting `https://…` URL.

## What the handler does

[`handler.ts`](src/handler.ts) wraps a single Vercel AI SDK `streamText` call with
`fromVercelAI`, which translates the SDK's stream into Sharely `AgentEvent`s for
you. The model gets two kinds of tools:

- **First-party Sharely tools** — `semantic_search`, `search_knowledge`,
  `get_knowledge_item`, `list_taxonomies`, `get_taxonomy_knowledge`,
  `get_workspace_stats`, `list_roles`. Each is built from `input.context`, so calls
  are scoped and governed by the platform automatically.
- **A custom tool** — `get_weather`, defined entirely in this server (backed by the
  free `wttr.in`, no API key). Shows how to mix your own tools with the platform's.

`stopWhen: stepCountIs(8)` bounds the tool-calling loop, and `input.signal` (client
disconnect) is forwarded into `streamText` so runs abort cleanly.

## Notes

- **Swap the provider.** `model: openai(MODEL)` is just the Vercel AI SDK — swap in
  any provider it supports (Anthropic, etc.) and adjust `OPENAI_API_KEY` accordingly.
- **Persistence is the server's job.** `@sharelyai/server` stores history in
  `agentMessage` and invokes the handler per turn with it via `toCoreMessages(input)`.

## Env vars

| Var                         | Notes                                            |
| --------------------------- | ------------------------------------------------ |
| `SHARELY_API_URL`           | sharelyai-be base URL (defaults to `https://api.sharely.ai`) |
| `SHARELY_WORKSPACE_ID`      | your workspace id                                |
| `SHARELY_WORKSPACE_API_KEY` | workspace access-key token                       |
| `OPENAI_API_KEY`            | read by `@ai-sdk/openai`                          |
| `PORT`                      | defaults to `8081`                               |
</content>
</invoke>
