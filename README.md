# Sharely Server SDK

The Sharely Server SDK is how you bring your own agent to the Sharely platform.
You own and host the agent logic; the platform routes a user's chat turn to your
server and streams the response back into the portal where the user is working.

It exists because Sharely splits the platform into parts you run and parts Sharely
manages. Knowledge, governance (RBAC), and the control plane that routes requests
and validates identity are managed by Sharely. The agent itself — its model,
framework, tools, and infrastructure — is yours. The SDK is the contract between
the two: it implements the HTTP, auth, token validation, persistence, and SSE wire
format, so your code only has to produce the answer.

Within a request, the SDK connects your agent to three platform capabilities:

- **Sharely Knowledge** *(managed)* — retrieval over governed, role-scoped content
  (ingestion, taxonomies, RAG, RBAC). Your agent queries it through a typed,
  request-scoped platform client; results are already filtered to the calling
  user's role.
- **WebControl** *(open)* — the embeddable delivery surface. It renders the events
  your agent streams — thinking steps, tool calls, citations — inside an existing
  web portal, so there is no client UI to build.
- **Control plane** *(managed)* — routes each turn to your server, validates the
  user's token, and persists the conversation, so your handler never deals with
  auth, the wire format, or storage.

Different roles often need different agent behavior, not just different documents —
a finance agent and a volunteer agent may draw on the same knowledge but differ in
tools and guardrails. Running that as code you own and host is what this SDK is for.

---

Build a **Sharely-compatible agent server**. You bring the agent logic — an
async generator that yields typed events — and the SDK owns the rest: HTTP,
auth, token validation, message persistence, and Server-Sent Events (SSE)
encoding. The Sharely platform dispatches a chat turn to your server and streams
your agent's output straight back to the user.

```ts
import { createSharelyServer } from '@sharelyai/server';

const app = createSharelyServer({
  apiUrl: process.env.SHARELY_API_URL!,
  workspaceId: process.env.SHARELY_WORKSPACE_ID!,
  workspaceApiKey: process.env.SHARELY_WORKSPACE_API_KEY!,
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

That's a complete, working agent server.

## Install

```bash
npm i @sharelyai/server @sharelyai/protocol
```

`@sharelyai/server` is the runtime; `@sharelyai/protocol` provides the
(types-only) `Handler` and `AgentEvent` definitions you write against. Add an
adapter package if you want to plug a framework's stream straight in — see
[Packages](#packages).

## The `Handler` contract

Every agent is one function shape:

```ts
type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;
```

The input gives you the user's message, prior thread history, a request-scoped
`AgentContext` (workspace/thread ids, a typed platform API client, a trace
span), and an `AbortSignal` that fires when the client disconnects:

```ts
interface AgentInput {
  message: string;
  history: AgentMessage[];
  context: AgentContext;
  signal: AbortSignal;
}
```

Your `Handler` `yield`s typed `AgentEvent`s. The server reduces them into the
assistant message, persists it, and encodes each one as SSE — you never touch
the wire, persistence, or auth.

### The wire protocol

`AgentEvent` is a discriminated union of **12 in-band events**:

`message_start`, `thinking_start`, `thinking_delta`, `thinking_end`,
`tool_call_start`, `tool_call_end`, `content_delta`, `content_end`, `sources`,
`metadata_update`, `message_end`, `error`.

A well-formed turn starts with `message_start` and ends with `message_end`. The
server appends a wire-only `done` event after your stream completes and wraps
every event in a `{ threadId, messageId }` envelope — you don't emit `done`
yourself. Full type definitions live in
[`@sharelyai/protocol`](packages/protocol/README.md).

## Configuration

`createSharelyServer(options)`:

| Option | Required | Default | Purpose |
| --- | --- | --- | --- |
| `apiUrl` | ✓ | — | Sharely platform base URL (e.g. `https://api.sharely.ai`). |
| `workspaceId` | ✓ | — | Your Sharely workspace id. |
| `workspaceApiKey` | ✓ | — | Workspace API key (`sk-sharely-*`). Used to validate incoming user tokens and to call the platform on your behalf. |
| `handler` | ✓ | — | Your `Handler`, or a per-request factory `(req) => Handler`. |
| `allowedOrigins` | | _unset_ | CORS allowlist (string or `string[]`). **If unset, cross-origin browser requests are disabled** (and a warning is logged) — set it for browser clients. |
| `enableProxy` | | `true` | Catch-all reverse proxy to the platform for unmatched routes. An explicit trust boundary — see the [server README](packages/server/README.md#security-boundaries). Set `false` to 404 instead. |
| `logger` | | console | A `Logger` (`debug`/`info`/`warn`/`error`) to integrate with your stack. |
| `rateLimitPerMinute` | | `20` | Per-auth-key rate limit on the chat route. |
| `fetcherTimeoutMs` | | `30000` | Upstream request timeout. |
| `validateIncomingToken` | | `true` | Validate the incoming user token before invoking the `Handler`. Disable only for trusted test fixtures. |

The example and demo servers read these from environment variables —
`SHARELY_API_URL`, `SHARELY_WORKSPACE_ID`, `SHARELY_WORKSPACE_API_KEY` — see any
`.env.example`.

### Graceful shutdown

`@sharelyai/server` exports an `installGracefulShutdown` helper that drains
in-flight SSE streams on `SIGTERM`/`SIGINT`:

```ts
import { createSharelyServer, installGracefulShutdown } from '@sharelyai/server';

const app = createSharelyServer({ /* … */ });
const server = app.listen(8080);
installGracefulShutdown(server);
```

## Packages

| Package | Purpose |
| --- | --- |
| [`@sharelyai/server`](packages/server/README.md) | Express runtime — HTTP, CORS, auth, token validation, persistence, SSE encoding. |
| [`@sharelyai/protocol`](packages/protocol/README.md) | Wire types — `Handler`, `AgentInput`, `AgentContext`, the `AgentEvent` union. Types only, no runtime. |
| [`@sharelyai/api`](packages/api/README.md) | Typed client to the Sharely platform (persistence, token validation). |
| [`@sharelyai/tools`](packages/tools/README.md) | First-party Sharely tool definitions + a pluggable executor registry. |
| `@sharelyai/adapter-vercel-ai` | Translate a Vercel AI SDK `streamText` stream into `AgentEvent`s. |
| `@sharelyai/adapter-temporal` | Translate a Temporal workflow's signals into `AgentEvent`s. |
| `@sharelyai/conformance` | Validate any `AgentEvent` stream against the wire-protocol contract. |

## Examples

Minimal reference servers live in [`examples/`](examples/) — each is a
`handler.ts` + `server.ts` wired into `createSharelyServer`, plus a `smoke.mjs`
you can run with **no API keys** (it mocks the platform). Build the workspace
first, then run a smoke:

```bash
npm install
npx turbo run build
node examples/anthropic-sdk-direct/smoke.mjs
```

| Example | What it shows |
| --- | --- |
| [`anthropic-sdk-direct`](examples/anthropic-sdk-direct/) | Raw Anthropic SDK multi-turn loop with mid-stream tool calls. |
| [`openai-agents-sdk`](examples/openai-agents-sdk/) | Observing an OpenAI Agents SDK streamed run. |
| [`langgraph`](examples/langgraph/) | Observing a compiled LangGraph's `streamEvents`. |
| [`raw-streaming`](examples/raw-streaming/) | No framework — a hand-rolled async generator. |
| [`adapter-vercel-ai`](examples/adapter-vercel-ai/) | `fromVercelAI(...)` — ~15 lines, swap in any provider. |
| [`adapter-temporal`](examples/adapter-temporal/) | `fromTemporal({ client })` with a real Temporal client. |

## Live demos

Full, runnable demo servers live in [`apps/`](apps/). Unlike the offline
`examples/`, these connect to a **real Sharely workspace and LLM provider** —
copy the demo's `.env.example` to `.env`, fill in the keys, then run it. Each is
`private` and never published to npm.

| Demo | Stack | Run |
| --- | --- | --- |
| [`live-demo-vercel`](apps/live-demo-vercel/) | Vercel AI SDK adapter | `npm run dev -w sharely-live-demo-vercel` (`:8081`) |
| [`live-demo-temporal`](apps/live-demo-temporal/) | Temporal adapter (server + worker) | `npm run dev -w sharely-live-demo-temporal` (`:8082`) |
| [`live-demo-langgraph`](apps/live-demo-langgraph/) | LangGraph | `npm run dev -w sharely-live-demo-langgraph` (`:8083`) |
| [`live-demo-temporal-ai-sdk`](apps/live-demo-temporal-ai-sdk/) | Temporal + AI SDK plugin | `npm run dev -w sharely-live-demo-temporal-ai-sdk` (`:8084`) |

The Temporal demos run a separate worker process alongside the server — see the
demo's README for the worker command.

## Development

```bash
npm install            # install all workspaces (packages/* + apps/*)
npx turbo run build    # build every package
npx turbo run typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release process.

## License

[Apache-2.0](LICENSE) © Sharely.ai Inc.
