# @sharely/server

Express runtime for Sharely-compatible agent servers. **Drop in a `Handler`, get back a fully wired Express app** — HTTP, auth, persistence, SSE encoding, and the catch-all Sharely-platform proxy are all handled for you.

## Install

```bash
npm i @sharely/server @sharely/protocol
```

## Minimum viable server

```ts
import { createSharelyServer } from "@sharely/server";

const app = createSharelyServer({
  apiUrl: process.env.SHARELY_API_URL!,   // e.g. https://sharely-develop.fly.dev
  workspaceId: process.env.WORKSPACE_ID!,
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  handler: async function* (input) {
    yield { type: "message_start", role: "assistant", model: "echo-v1" };
    yield { type: "content_delta", delta: `Echo: ${input.message}` };
    yield {
      type: "message_end",
      finishReason: "stop",
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }
});

app.listen(8080);
```

That's it. Customer-side adapter packages (`@sharely/adapter-vercel-ai`, `@sharely/adapter-temporal`) produce the same `Handler` shape — see their READMEs.

## What this owns (so you don't reimplement it)

- **HTTP**: Express, CORS, 10 MB body limits, auth-keyed rate limit on the chat route.
- **Auth split**: extracts the incoming bearer, rejects `null`/`undefined`/`public`. The configured `workspaceApiKey` is used **only** to call `/api-authenticated` (validating the incoming user token is admin-class). Every other Backplane call (persistence, RAG) forwards the **incoming user JWT** so the platform's RBAC checks (`getTokenRoleId` against `agentThread.roleId`) operate against the real user. This server never mints tokens.
- **Persistence**: routes user + assistant `agentMessage` rows through `@sharely/api` against the agent-threads Backplane, including the rich columns (`thinkingSteps`, `toolCalls`, `sources`, `tokenUsage`).
- **Streaming**: extracted SSE encoder from `sharelyai-be/agent/sse.ts`, client-disconnect → `AbortSignal`.
- **Routes**:
  - `POST /agent/threads/:threadId/chat` — the agent-turn entrypoint
  - `GET /goals/spaces/:spaceId` — silenced-404 shim
  - `GET /health` — liveness
  - `*` — catch-all proxy to `apiUrl` (forwards header-sanitized requests)
- **Operational**: PII-safe logger (no message history is ever logged), retrying fetcher with 30s timeout + exponential backoff on 5xx, trace span lifecycle.

## What `Handler`s should NOT do

Mint tokens, persist messages, define new event types, or invent cancellation primitives. Yield typed `AgentEvent`s, let the server own the wire + persistence + auth surface.

## See also

- [`@sharely/protocol`](https://www.npmjs.com/package/@sharely/protocol) — wire types, `Handler` contract
- [`@sharely/api`](https://www.npmjs.com/package/@sharely/api) — typed client to the Sharely platform Backplane
- [`@sharely/tools`](https://www.npmjs.com/package/@sharely/tools) — first-party tool definitions

## Smoke

A runnable acceptance smoke (mock Backplane + inline `Handler` + assertion on event sequence) lives at [`examples/smoke.mjs`](./examples/smoke.mjs). Build the workspace, then:

```bash
node packages/server/examples/smoke.mjs
```
