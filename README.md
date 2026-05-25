# Sharely Server SDK

> **Status / handoff document.** This README is the working-context summary of the SDK — what is built, what was decided, what is verified, and what comes next. It is written to be picked up by another engineer or model mid-build.

---

## 1. What this is

The customer-facing surface for building a **Sharely-compatible agent server**. A Sharely workspace runs its agent in one of three places, all dispatched by the Sharely platform (`sharelyai-be`) and all speaking the **same SSE event protocol**:

1. **Sharely-hosted default loop** — the built-in Anthropic agentic loop (`runAgentLoop`).
2. **Sharely-hosted agentflow** — visual no-code flows (`runAgentflowChat`).
3. **Customer-hosted agent server** — _this SDK_. The customer brings agent logic; the SDK owns HTTP, auth, persistence, and streaming.

The SDK is a **refactor of proven code into published packages** — the wire protocol and tool definitions are _extracted_ from `sharelyai-be`'s production agent runtime, not designed fresh.

This is a Turborepo monorepo (`packages/*` workspaces, npm). Sibling repos used as source/targets live at `../sharelyai-be` (the backend), `../customagentserver` (the legacy fork-the-template model), `../agentflow`, `../jswebcontrol`.

---

## 2. Phase status

| Phase                                    | State           | Notes                                                                                                                                                                                                                                                     |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Bootstrap**                        | ✅ Done         | Turborepo + workspaces + shared tsconfig. **CI and Changesets deliberately omitted** per repo-owner decision.                                                                                                                                             |
| **1 — Protocol + server runtime**        | ✅ Done in-repo | `@sharelyai/protocol`, `@sharelyai/server`, `@sharelyai/tools`, `@sharelyai/api` built + green. Backend dispatch branch landed in `sharelyai-be`.                                                                                                         |
| **2 — Conformance harness + 2 adapters** | ✅ Done         | `@sharelyai/conformance` + `@sharelyai/adapter-vercel-ai` + `@sharelyai/adapter-temporal`, all passing conformance.                                                                                                                                       |
| **3 — Pattern C examples**               | ✅ Done         | `examples/`: Pattern C — `anthropic-sdk-direct`, `openai-agents-sdk`, `langgraph`, `raw-streaming`. Adapter-backed — `adapter-vercel-ai`, `adapter-temporal`. Each is handler + server + runnable smoke + README; all type-check clean, all smokes green. |

---

## 3. Packages

All live under `packages/`, all build green via `npx turbo run build`.

| Package                        | LOC | State    | Purpose                                                                                                       |
| ------------------------------ | --: | -------- | ------------------------------------------------------------------------------------------------------------- |
| `@sharelyai/protocol`          | 269 | ✅ Ready | Wire types — `AgentEvent` union, `Handler`/`AgentInput`/`AgentContext`, domain + tool types. No runtime code. |
| `@sharelyai/server`            | 516 | ✅ Ready | Express runtime — HTTP, CORS, rate limit, token validation, SSE encoding, persistence, catch-all proxy.       |
| `@sharelyai/api`               | 242 | ✅ Ready | Typed client to the `sharelyai-be` Backplane + `tokens.validate()`. Hand-written; OpenAPI-generated later.    |
| `@sharelyai/tools`             | 169 | ✅ Ready | The 7 first-party Sharely tool **definitions** + pluggable executor registry.                                 |
| `@sharelyai/adapter-vercel-ai` | 263 | ✅ Ready | Vercel AI SDK `streamText` ⇄ `AgentEvent` translator.                                                         |
| `@sharelyai/adapter-temporal`  | 222 | ✅ Ready | Temporal workflow ⇄ `AgentEvent` translator (`fromTemporal` + `emitAgentEvent`).                              |
| `@sharelyai/conformance`       | 322 | ✅ Ready | Event-stream validator + golden scenarios + handler runner.                                                   |

> Note: `@sharelyai/server` is 516 LOC — slightly over the original ≤500 budget after token validation was added.

---

## 4. Architecture / key concepts

### The `Handler` contract

Every agent — adapter-produced or raw (Pattern C) — is one function shape:

```ts
type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;
```

The `Handler` yields typed `AgentEvent`s; `@sharelyai/server` owns everything else.

### The wire protocol (`@sharelyai/protocol`)

`AgentEvent` is a discriminated union of 11 in-band events: `message_start`, `thinking_start`/`_delta`/`_end`, `tool_call_start`/`_end`, `content_delta`, `content_end`, `sources`, `message_end`, `error`. The server adds a 12th wire-only event, `done`, and wraps every event with a `{ threadId, messageId }` envelope. Extracted verbatim from `sharelyai-be/src/controller/agent/types.ts`.

### Three execution models

`sharelyai-be`'s chat endpoint dispatches one turn to one of three places — all speaking the same SSE event protocol, so an adapter-produced, raw-`Handler`, no-code-flow, or hosted-Anthropic-loop run are all interchangeable on the wire:

```
POST .../agent/threads/:threadId/chat
        │
        ├─ thread.agentServerId set?      → stream from customer's @sharelyai/server  (this SDK)
        │
        ├─ workspace.defaultAgentflowId?  → runAgentflowChat  (Sharely-hosted, no-code visual flows)
        │
        └─ else                           → runAgentLoop       (Sharely-hosted Anthropic loop)
```

### Request flow

```
WebControl ──▶ sharelyai-be  POST /workspaces/:wsId/agent/threads/:threadId/chat   (user JWT)
                   │
                   └─ thread.agentServerId set?
                          │ yes → proxyToAgentServer (streams SSE straight through)
                          ▼
              @sharelyai/server  POST /agent/threads/:threadId/chat
                   1. validate the user token → POST /v1/workspaces/:wsId/api-authenticated
                   2. persist user message    → Backplane
                   3. run the Handler, encode AgentEvents as SSE
                   4. persist assistant message (thinkingSteps/toolCalls/sources/tokenUsage)
                   5. emit `done`
```

### Ownership boundaries

**`@sharelyai/server` owns** (customers never reimplement): HTTP + CORS + body limits + rate limit, the two-key auth split (validation via `workspaceApiKey`, persistence via incoming user JWT), SSE encoding + envelope, persistence to `agentThread`/`agentMessage`, retrying fetcher with header sanitization, request-scoped `AgentContext`, trace span lifecycle, client-disconnect → `AbortSignal`.

**Adapters must NOT**: define new event types, implement tools, invent cancellation primitives, persist messages, retry/fallback, implement tracing, touch auth/RBAC/orchestration/model choice/prompts/tool composition. Adapters are **narrow translators**.

---

## 5. Changes already made in `sharelyai-be` (cross-repo)

The customer-hosted path required backend work. All committed and typecheck-clean (`etsc` + `tsc --noEmit`):

- **`prisma/schema.prisma`** — new `AgentServer` model `{ id, name, url, status, metadata, workspaceId, ... }`; `AgentThread.agentServerId` is now a real FK; `Workspace.agentServers` reverse relation; indexes added.
- **`src/controller/agent/user.ts`** — `chat` dispatch branch: when `thread.agentServerId` is set + the server is `ACTIVE`, proxy the turn to the customer server and return.
- **`src/controller/agent/agent-server-proxy.ts`** (new) — streams the customer server's SSE response straight back, with abort handling + structured logs.
- **`src/controller/agent/backplane.ts`** — `AgentServer` CRUD (`create`/`list`/`get`/`update`/`delete`, soft-delete).
- **`src/utils/schemas.ts`** — `AGENT_BACKPLANE_AGENT_SERVER_CREATE` / `_UPDATE` yup schemas.
- **`src/index.ts`** — 5 routes under `/v1/workspaces/:workspaceId/agent/servers`, guarded by `isApiKeyAuthenticated`.

---

## 6. Key decisions

- **`conformance` is `packages/conformance`** (a workspace package, not a repo-root directory) — keeps workspace resolution clean (adapters depend on it as a devDependency).
- **`done` is wire-only.** The `Handler` emits `message_start … message_end`; the server appends `done`. `AgentEvent` does not include `done`.
- **`@sharelyai/api` is hand-written**, covering the Backplane route subset. To be regenerated from an OpenAPI spec once `sharelyai-be` ships one.
- **`@sharelyai/tools` ships definitions only.** The 7 tools have no default `execute` (the upstream ones hit Prisma/Pinecone directly and can't ship publicly). Executors plug in via `createTools({ ... })`.
- **Token validation is on by default** — the SDK calls `/v1/workspaces/:wsId/api-authenticated` to validate the incoming user JWT before invoking the Handler. Disable with `validateIncomingToken: false` (only safe for trusted test fixtures).
- **Adapters are typed structurally** — they do not import `ai` or `@temporalio/*`, so they survive framework major-version churn.
- **Inter-package deps use `"*"`** (repo-owner instruction) — not pinned semver ranges.
- **No CI, no Changesets** — repo owner publishes manually with `npm publish`.
- The shared TS config is the published **`@sharelyai/tsconfig`** (note the `ai` — different scope from this SDK's `@sharelyai/*`); `strict` is `false` there.

---

## 7. Examples

[`examples/`](examples/) — snippet-style (not packages), each one a customer-form `handler.ts` + `server.ts` wired into `createSharelyServer`, plus a runnable `smoke.mjs` (JS port + mocks, no API keys needed) and a `README.md`:

**Pattern C — raw `Handler`s, no SDK abstractions:**

- [`anthropic-sdk-direct/`](examples/anthropic-sdk-direct/) — multi-turn loop, mid-stream `tool_call_start` via `input_json_delta` buffering, batched sources from `ToolResult`.
- [`openai-agents-sdk/`](examples/openai-agents-sdk/) — observes `run(agent, …, { stream: true })`; defensive accessors throw on shape drift; sources by convention on tool outputs.
- [`langgraph/`](examples/langgraph/) — observes `streamEvents(input, { version: 'v2' })` from a compiled graph; structural `StreamableGraph` typing to avoid pinning @langchain/langgraph versions.
- [`raw-streaming/`](examples/raw-streaming/) — no framework; an async generator with a hand-rolled 2-turn loop, `runLLMTurn` / `runTool` stubs the customer replaces.

**Adapter-backed — published `@sharelyai/adapter-*` packages do the translation:**

- [`adapter-vercel-ai/`](examples/adapter-vercel-ai/) — `fromVercelAI(input => streamText({...}))` with `@ai-sdk/gateway` (swap for any provider). First-party `semantic_search` tool wired in. ~15 lines.
- [`adapter-temporal/`](examples/adapter-temporal/) — `fromTemporal({ client })` with a real `@temporalio/client` `Client` wrapped via `wrapTemporalClient`. README includes the worker-side workflow snippet using `createAgentEventSink` + `emitAgentEvent`.

**Also outstanding** (not phase-bound):

- READMEs exist for `protocol`, `server`, `api`, `tools` — none yet for the two adapters or `conformance`.
- No unit tests beyond the `.mjs` smokes; no test runner is wired.
- The auth-coupling note in §4 assumes the customer server has a real `workspaceApiKey` — confirm the platform issues these per workspace.

---

## 8. Build & test

```bash
npm install                                            # all workspaces
npx turbo run build                                    # build 7 packages
node packages/server/examples/smoke.mjs                # server acceptance smoke
node packages/adapter-vercel-ai/examples/conformance.mjs
node packages/adapter-temporal/examples/conformance.mjs
```

Each package: `build` (`tsc`), `typecheck` (`tsc --noEmit`), `clean`. TS config extends `@sharelyai/tsconfig/base.json`.

---

## 9. Repo layout

```
sharely-server-sdk/
├── packages/
│   ├── protocol/            @sharelyai/protocol            — wire types
│   ├── server/              @sharelyai/server              — Express runtime
│   ├── api/                 @sharelyai/api                 — Backplane client
│   ├── tools/               @sharelyai/tools               — tool definitions
│   ├── adapter-vercel-ai/   @sharelyai/adapter-vercel-ai   — Vercel AI translator
│   ├── adapter-temporal/    @sharelyai/adapter-temporal    — Temporal translator
│   └── conformance/         @sharelyai/conformance         — test harness
├── examples/                Reference snippets (Phase 3)
│   ├── anthropic-sdk-direct/    Pattern C — raw Anthropic SDK loop
│   ├── openai-agents-sdk/       Pattern C — observes OpenAI Agents SDK runs
│   ├── langgraph/               Pattern C — observes LangGraph streamEvents
│   ├── raw-streaming/           Pattern C — no framework, hand-rolled
│   ├── adapter-vercel-ai/       Adapter-backed — @sharelyai/adapter-vercel-ai
│   ├── adapter-temporal/        Adapter-backed — @sharelyai/adapter-temporal
│   └── tsconfig.check.json      shared type-check config for the examples
├── turbo.json
└── README.md                this file
```

Per-package READMEs: [protocol](packages/protocol/README.md) · [server](packages/server/README.md) · [api](packages/api/README.md) · [tools](packages/tools/README.md).

---

## License

MIT
