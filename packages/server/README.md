# @sharelyai/server

Express runtime for Sharely-compatible agent servers. **Drop in a `Handler`, get back a fully wired Express app** — HTTP, auth, persistence, SSE encoding, and the catch-all Sharely-platform proxy are all handled for you.

## Install

```bash
npm i @sharelyai/server @sharelyai/protocol
```

## Minimum viable server

```ts
import { createSharelyServer } from '@sharelyai/server';

const app = createSharelyServer({
  apiUrl: process.env.SHARELY_API_URL!, // e.g. https://api.sharely.ai
  workspaceId: process.env.WORKSPACE_ID!,
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  handler: async function* (input) {
    yield { type: 'message_start', role: 'assistant', model: 'echo-v1' };
    yield { type: 'content_delta', delta: `Echo: ${input.message}` };
    yield {
      type: 'message_end',
      finishReason: 'stop',
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  },
});

app.listen(8080);
```

That's it. Customer-side adapter packages (`@sharelyai/adapter-vercel-ai`, `@sharelyai/adapter-temporal`) produce the same `Handler` shape — see their READMEs.

## What this owns (so you don't reimplement it)

- **HTTP**: Express, CORS, 10 MB body limits, auth-keyed rate limit on the chat route.
- **Auth split**: extracts the incoming bearer, rejects `null`/`undefined`/`public`. The configured `workspaceApiKey` is used **only** to call `/api-authenticated` (validating the incoming user token is admin-class). Every other Backplane call (persistence, RAG) forwards the **incoming user JWT** so the platform's RBAC checks (`getTokenRoleId` against `agentThread.roleId`) operate against the real user. This server never mints tokens.
- **Persistence**: routes user + assistant `agentMessage` rows through `@sharelyai/api` against the agent-threads Backplane, including the rich columns (`thinkingSteps`, `toolCalls`, `sources`, `tokenUsage`).
- **Streaming**: extracted SSE encoder from `sharelyai-be/agent/sse.ts`, client-disconnect → `AbortSignal`.
- **Routes**:
  - `POST /agent/threads/:threadId/chat` — the agent-turn entrypoint
  - `GET /goals/spaces/:spaceId` — silenced-404 shim
  - `GET /health` — liveness
  - `*` — catch-all proxy to `apiUrl` (forwards header-sanitized requests)
- **Operational**: PII-safe logger (no message history is ever logged), retrying fetcher with 30s timeout + exponential backoff on 5xx, trace span lifecycle.

## What `Handler`s should NOT do

Mint tokens, persist messages, define new event types, or invent cancellation primitives. Yield typed `AgentEvent`s, let the server own the wire + persistence + auth surface.

## Configuration

`createSharelyServer(options)` — key options beyond the required `apiUrl` / `workspaceId` / `workspaceApiKey` / `handler`:

| Option | Default | Purpose |
| --- | --- | --- |
| `allowedOrigins` | _unset_ | CORS allowlist (string or string[]). **See Security below** — leaving it unset disables cross-origin browser requests. |
| `enableProxy` | `true` | Enable the catch-all reverse proxy. Set `false` to return 404 for unmatched routes. **See Security below.** |
| `logger` | console logger | A `Logger` (`debug`/`info`/`warn`/`error`) to integrate with your stack (pino, winston, …). |
| `rateLimitPerMinute` | `20` | Per-auth-key rate limit on the chat route. |
| `fetcherTimeoutMs` | `30000` | Upstream request timeout. |
| `validateIncomingToken` | `true` | Validate the incoming user token against the platform before invoking the `Handler`. |

## Security boundaries

Two behaviours are explicit trust/security boundaries — understand them before deploying:

### CORS default

`allowedOrigins` is optional. When it is **not set**, the server does **not** reflect arbitrary origins (which, combined with `credentials: true`, would mean "allow any origin with credentials"). Instead, cross-origin browser requests are **disabled** and a warning is logged at startup. Set `allowedOrigins` to your front-end origin(s) to enable browser clients in production.

### Catch-all reverse proxy (`enableProxy`, default `true`)

Any request that doesn't match `/agent/threads/:threadId/chat`, `/goals/spaces/:spaceId`, or `/health` is **forwarded as-is to `apiUrl`**, passing the caller's headers through — **including `Authorization`**. This passthrough performs **no token validation of its own**; it delegates authorization entirely to the Sharely backend. Implications:

- It is a transparent pass-through to the platform, not a curated API. Routes you can reach through it are not part of this SDK's contract and may change.
- Auth is the backend's responsibility on this path.

Set `enableProxy: false` to disable it entirely (unmatched routes then 404). A future release may add a route allowlist; until then it is all-or-nothing.

## Graceful shutdown

`installGracefulShutdown(server, options?)` wires `SIGTERM`/`SIGINT` handlers that stop accepting new connections, let in-flight requests and SSE streams drain (bounded by `timeoutMs`, default 10s), run an optional `onShutdown` hook, then exit:

```ts
import { createSharelyServer, installGracefulShutdown } from '@sharelyai/server';

const app = createSharelyServer({ /* … */ });
const server = app.listen(8080);
installGracefulShutdown(server, { onShutdown: () => pool.end() });
```

## Observability

Pass a custom `logger` to route output to your logging stack. The default is a console logger whose `debug` level is gated on `DEBUG=true`.

> **Note:** `AgentContext.trace` (`TraceSpan`) is currently a **stub** — its `event`/`child`/`end` calls write to the debug logger only. There is no real OpenTelemetry/distributed-tracing wiring yet. Treat it as a placeholder API.

## See also

- [`@sharelyai/protocol`](https://www.npmjs.com/package/@sharelyai/protocol) — wire types, `Handler` contract
- [`@sharelyai/api`](https://www.npmjs.com/package/@sharelyai/api) — typed client to the Sharely platform Backplane
- [`@sharelyai/tools`](https://www.npmjs.com/package/@sharelyai/tools) — first-party tool definitions

## Smoke

A runnable acceptance smoke (mock Backplane + inline `Handler` + assertion on event sequence) lives at [`examples/smoke.mjs`](./examples/smoke.mjs). Build the workspace, then:

```bash
node packages/server/examples/smoke.mjs
```
