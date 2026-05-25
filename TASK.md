# Sharely Server SDK — Build Plan

> **Status:** Pre-implementation · **Source of truth:** Spec 02 (Sharely Server SDK) · **This document:** the implementation guide — what must be built, in what order, and how to know it's done.

This repo will hold the customer-facing surface for building a Sharely-compatible agent server: the wire protocol types, the server runtime, two adapters, the tools package, and the platform API client. It is a **refactor of proven code into published packages** — not a green-field build.

**Two things were discovered while writing this plan and they reshape it:**

1. `sharelyai-be` (the real backend) **already runs agents** — it has a hosted agent runtime, the SSE wire protocol, and the knowledge tools, all in production. The SDK does not _design_ these; it _extracts and publishes_ them. See §5 and §6.
2. The customer-hosted agent server is **one of three execution models**, all dispatched by `sharelyai-be` and all speaking the same protocol. See §5.3.

---

## 1. Decisions already made

| Question              | Decision                                                                 | Why                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where does this live? | **New dedicated public repo** (`sharely-server-sdk`)                     | `sharelyai-mono` is private internal infra; `webcontrol` is the widget; `sharelyai-be` is the backend. The SDK is public, `npm install`-able, and versions on its own cadence. |
| Repo shape            | Small **workspace monorepo** (Turborepo + Changesets)                    | Six interdependent published packages need coordinated semver + changelogs.                                                                                                    |
| npm scope             | `@sharelyai/*` (public); community adapters under `@sharely-community/*` | Spec principle #8 — versioned everything.                                                                                                                                      |
| Server runtime        | Express only in v1                                                       | Framework-agnostic `Request`/`Response` handler is a follow-on.                                                                                                                |
| Agent frameworks      | Two first-party adapters only: Vercel AI SDK + Temporal                  | Everything else uses Pattern C (raw `Handler`). Principle #1 — don't build a competing framework.                                                                              |
| Wire protocol origin  | **Extract the incumbent**, do not design new                             | `sharelyai-be/src/controller/agent/types.ts` + `sse.ts` are already in production. `@sharelyai/protocol` ratifies them. See §6.                                                |
| Conversation store    | `agentThread` / `agentMessage` (the agent runtime model)                 | Not the legacy `space`/`message` model CAS uses. The agent model carries `thinkingSteps`/`toolCalls`/`sources`/`tokenUsage`. See §5.4.                                         |

---

## 2. Target repo layout

```
sharely-server-sdk/
├── package.json                 # workspaces: packages/*, private root
├── turbo.json                   # build/test/lint pipeline
├── tsconfig.base.json           # shared TS config
├── .changeset/                  # Changesets — versioning + publish
├── .github/workflows/           # CI: build, test, conformance, publish
├── packages/
│   ├── protocol/                # @sharely/protocol   — types only, ~250 LOC
│   ├── server/                  # @sharely/server     — Express runtime, ≤500 LOC
│   ├── tools/                   # @sharely/tools      — Sharely tool defs, ~200 LOC
│   ├── api/                     # @sharely/api        — generated platform client
│   ├── adapter-vercel-ai/       # @sharely/adapter-vercel-ai  — ~200 LOC
│   └── adapter-temporal/        # @sharely/adapter-temporal   — ~300 LOC
├── examples/                    # Pattern C reference snippets — NOT packages
│   ├── anthropic-sdk-direct/
│   ├── openai-agents-sdk/
│   ├── langgraph/
│   ├── mastra/
│   └── raw-streaming/
└── conformance/                 # shared adapter conformance test harness
```

---

## 3. The packages — what each one is

| Package                        | Purpose                                                                                                                              | LOC budget | Build type                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------: | ---------------------------- |
| `@sharelyai/protocol`          | Wire types extracted from `sharelyai-be/src/controller/agent/types.ts` + `Handler`/`AgentInput`/`AgentContext`. No runtime code.     |       ~250 | **Extract**                  |
| `@sharelyai/server`            | Express runtime: HTTP, auth proxy, conversation persistence, SSE encoding, tracing hooks. Refactor of `customagentserver/src/core/`. |   **≤500** | **~70% port / ~30% new**     |
| `@sharelyai/tools`             | Sharely tool definitions, extracted from `sharelyai-be/src/controller/agent/tools/`. Single source of truth.                         |       ~200 | **Extract**                  |
| `@sharelyai/api`               | Typed client to **`sharelyai-be`** (Sharely Platform Services). Generated from OpenAPI (Spec 04).                                    |  generated | Depends on Spec 04 + backend |
| `@sharelyai/adapter-vercel-ai` | Vercel AI SDK ⇄ wire protocol translator + tool re-exports.                                                                          |       ~200 | New                          |
| `@sharelyai/adapter-temporal`  | Temporal workflow ⇄ wire protocol translator + `emitAgentEvent`.                                                                     |       ~300 | New                          |

---

## 4. The real backend — `sharelyai-be`

The spec's diagrams call it "Sharely Platform" / "api.sharely.ai". In this monorepo it is the **`sharelyai-be` repo**.

- **Express + Prisma/PostgreSQL** application; private repo. Deployed on **Fly.io** — dev env `https://sharely-develop.fly.dev` (the value behind `SHARELY_API_URL`).
- Owns: thread/message persistence, knowledge repository + retrieval (LangChain + **Pinecone** + **Elasticsearch**), RBAC, authentication, access-key tokens, goals, audiences — **and a hosted agent runtime (§5)**.
- Auth: a **workspace access-key token**, validated by `validateAKToken(token, workspaceId)`; rejects `Bearer null`/`undefined`/`public`. `@sharelyai/server` never mints or validates tokens — it forwards the incoming `Authorization` header unchanged. RBAC is enforced inside `sharelyai-be`.
- `sharelyai-be` is private. The SDK must **not** vendor its code or import its types. The single sanctioned coupling is `@sharelyai/api`, generated from `sharelyai-be`'s OpenAPI spec — which **must be authored** if it does not exist (see §10).

---

## 5. The agent runtime already inside `sharelyai-be`

**This is the most important context for the SDK.** `sharelyai-be/src/controller/agent/` is a complete, production agent runtime. The SDK is not new infrastructure — it is the _third dispatch target_ of a system that already works.

### 5.1 The chat endpoint

`POST /workspaces/:workspaceId/agent/threads/:threadId/chat` → `AgentController.User.chat` (`agent/user.ts:464-772`).

What it does, in order:

1. Validates `{ threadId, message, languageId, topK }`.
2. Resolves the caller — a real user **or** a `temporalUserId` (anonymous user) — and a `roleId`.
3. Loads `prisma.agentThread` (+ its `workspace`: `rbacStatus`, `systemPrompt`, `defaultAgentflowId`, `defaultAgentVersionId`).
4. RBAC gate: if `rbacStatus` active and `thread.roleId !== roleId` → reject.
5. Writes SSE headers — `text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. **These are the headers Spec 02 wants and CAS lacks — `sharelyai-be` already does it right.**
6. Persists the user message to `prisma.agentMessage`.
7. Loads history — last 50 `agentMessage` rows.
8. **Dispatches** (see §5.3) and streams `AgentEvent`s.
9. Persists the assistant message with `thinkingSteps`, `toolCalls`, `sources`, `tokenUsage`, `model`, `finishReason`, `metadata`.
10. Emits `message_end`, then `done`, ends the stream.

### 5.2 The two runtimes that exist today

| Runtime                | File                                             | What it is                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default agent loop** | `agent/agent.ts` — `runAgentLoop`                | Native Anthropic SDK agentic loop (Claude Sonnet 4, `MAX_ITERATIONS=20`), the built-in knowledge tools, global citation numbering.                                                                                         |
| **Agentflow runner**   | `agent/agentflow-runner.ts` — `runAgentflowChat` | Runs **no-code / visual** agents — `langflow` flows compiled to workflows via `@sharelyai/agentflow-runtime`. Flow definitions live in a separate Supabase DB (`agents`, `agent_versions`). Maps node events → SSE events. |

### 5.3 The three execution models — and where the SDK fits

`chat` currently dispatches to two targets. The customer-hosted agent server is the **intended third**:

```
POST .../agent/threads/:threadId/chat
        │
        ├─ thread.agentServerId set?      → ❌ NOT WIRED YET
        │     → stream from customer's @sharely/server (this SDK)   ← Patterns A/B/C
        │
        ├─ workspace.defaultAgentflowId?  → runAgentflowChat   (Sharely-hosted, no-code)
        │
        └─ else                           → runAgentLoop       (Sharely-hosted, default)
```

All three emit the **same `SSEEventType` protocol** — that is the unifying contract and the reason the SDK is viable.

> ⚠️ **Gap to close.** `agentThread` has an `agentServerId` column and the Backplane `createThread` accepts it, but **`chat` does not yet branch on it**. Routing a chat to a customer's `@sharelyai/server` is a change _inside `sharelyai-be`_, not just SDK code. This must be a tracked work item co-owned with the backend team (see §10, §14).

### 5.4 The conversation data model

The agent runtime uses its own Prisma models — **distinct from the legacy `space`/`message` model that CAS persists to**:

- `agentThread` — `id, workspaceId, spaceId?, userId?, temporalUserId?, roleId?, title?, agentServerId?, updatedAt, deletedAt`.
- `agentMessage` — `id, threadId, role, content, thinkingSteps, toolCalls, sources, tokenUsage, model, finishReason, metadata`.

`agentMessage` has first-class columns for `thinkingSteps`, `toolCalls`, `sources`, `tokenUsage` — the legacy `message` model does not. **The SDK targets this model.** This is a correction to CAS behaviour: CAS persists via `POST /v1/workspaces/.../spaces/.../message`; `@sharelyai/server` should persist via the agent-threads API instead. See the refactor map (§8).

### 5.5 The "Backplane"

`AgentController.Backplane` (`agent/backplane.ts`, mounted at `/v1/workspaces/:workspaceId/agent/threads`) is the API surface for **external agent servers** — it creates `agentThread`s carrying `agentServerId`. This is the registration channel between a customer's `@sharelyai/server` and `sharelyai-be`. `@sharelyai/api` should target the Backplane endpoints.

---

## 6. The wire protocol — extracted, not designed

`@sharelyai/protocol`'s event types are **not invented by Spec 01** — they are the incumbent `sharelyai-be` protocol, published and versioned.

### 6.1 The event union (source: `agent/types.ts` `SSEEventType`)

```
message_start · thinking_start · thinking_delta · thinking_end ·
tool_call_start · tool_call_end · content_delta · content_end ·
sources · message_end · error · done
```

Twelve events. Note vs. Spec 02's prose: `thinking_delta` exists; `sources` is **batched (plural)**, not one-per-`source`; there is both a `content_end` and a `message_end` and a final `done`. **Spec 01 must ratify this exact union** — any divergence in the spec text (e.g. a singular `source` event) is a spec bug, not a design choice.

### 6.2 The framing (source: `agent/sse.ts`)

```ts
res.write(`event: ${type}\n`);
res.write(`data: ${JSON.stringify(data)}\n\n`);
```

Proper SSE. `@sharelyai/server`'s encoder is essentially this 14-line file. The "SSE encoder" is therefore **low-risk** — it already exists and runs in production.

### 6.3 Shared payload types (source: `agent/types.ts`)

`ThinkingStep`, `ToolCallRecord`, `TokenUsage`, and:

```ts
interface Source {
  id: string;
  type: 'knowledge' | 'semantic' | 'role' | 'stats' | 'taxonomy';
  title: string;
  url?: string;
  snippet?: string;
  metadata?: Record<string, unknown>;
}
```

Plus the tool contract — `Tool`, `ToolDefinition`, `ToolContext`, `ToolResult` — which `@sharelyai/tools` extends (§3).

> **Revised risk note.** An earlier draft of this plan called Phase 1 "a protocol redesign." That was wrong. The protocol is **designed and shipping** in `sharelyai-be`. Phase 1's real work is narrower: make `@sharelyai/server` (the CAS refactor) _emit the protocol that already exists_. CAS's plain-text-with-emoji-markers streaming is the outlier to be deleted — not a protocol to be replaced with a new invention.

---

## 7. The contract — `Handler`

`@sharelyai/server` invokes exactly one function shape. Every adapter produces it; Pattern C implements it directly.

```ts
// @sharely/protocol
export type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;

export interface AgentInput {
  message: string;
  history: AgentMessage[]; // agentMessage rows: { role, content }
  context: AgentContext;
  signal: AbortSignal;
}

export interface AgentContext {
  workspaceId: string;
  spaceId?: string;
  threadId: string;
  userId?: string;
  temporalUserId?: string; // anonymous-user identity — sharelyai-be supports both
  roleId?: string;
  languageId?: string;
  topK?: number;
  authorization: string;
  api: SharelyAPIClient; // @sharely/api → sharelyai-be, request-scoped (tenant + role pre-filtered)
  trace: TraceSpan; // Spec 06; builds on agent/log.ts (traceId/messageId)
}
```

`AgentContext` is aligned with `sharelyai-be`'s `ToolContext` + `chat` params (`roleId`, `languageId`, `topK`, `traceId`, `messageId`, `temporalUserId`) so a `Handler` and the hosted runtimes receive equivalent context.

```ts
// @sharely/server
export function createSharelyServer(opts: {
  handler: Handler | ((req: Request) => Handler | Promise<Handler>);
}): Express;
```

---

## 8. Where the code comes from — file-by-file refactor map

| Source                                      | Disposition in SDK                            | Notes                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharelyai-be` `agent/types.ts`             | **Extract** → `@sharelyai/protocol`           | `SSEEventType`, `Source`, `ThinkingStep`, `ToolCallRecord`, `TokenUsage`, `Tool*`. Published + versioned.                                                                        |
| `sharelyai-be` `agent/sse.ts`               | **Extract** → `@sharelyai/server` SSE encoder | 14 lines; the encoder already exists.                                                                                                                                            |
| `sharelyai-be` `agent/tools/*`              | **Extract** → `@sharelyai/tools`              | searchKnowledge, semanticSearch, getKnowledgeItem, listTaxonomies, getTaxonomyKnowledge, getWorkspaceStats, listRoles. Keep `sharelyai-be` and the SDK on one shared definition. |
| `CAS core/createServer.ts:67-91`            | **Port** → `server/src/app.ts`                | Express, CORS, 10 MB body limits.                                                                                                                                                |
| `CAS core/createServer.ts:30-53`            | **Port** → `server/src/rateLimit.ts`          | Auth-header-keyed rate limiter.                                                                                                                                                  |
| `CAS core/createServer.ts:98-148`           | **Port + rewrite** → entrypoint route         | Validation + auth stay; `AgentConfig` → `Handler`. **Endpoint open question — see §14.**                                                                                         |
| `CAS core/createServer.ts:154-223`          | **Port**                                      | Goals shim, `/test`, catch-all proxy to `sharelyai-be`.                                                                                                                          |
| `CAS core/messageHandler.ts:117-199`        | **Port + retarget**                           | History load + message persistence — **retarget from `/v1/.../message` to the agent-threads API (`agentThread`/`agentMessage`)**. See §5.4.                                      |
| `CAS core/messageHandler.ts:69-71`          | **DELETE**                                    | PII-leaking `logger.error(JSON.stringify({ messageHistory }))`.                                                                                                                  |
| `CAS core/messageHandler.ts:74-81, 212-256` | **DELETE**                                    | Auto-RAG branch + dead commented RAG code. RAG is a tool (Spec 03).                                                                                                              |
| `CAS core/streaming.ts:34-37`               | **Replace**                                   | Use `sharelyai-be`'s SSE header block (`Connection: keep-alive`, `X-Accel-Buffering: no`).                                                                                       |
| `CAS core/streaming.ts:40-41`               | **Port**                                      | `AbortController` on disconnect → `Handler` `signal`.                                                                                                                            |
| `CAS core/streaming.ts:88-122`              | **Replace**                                   | Plain-text `res.write(delta)` + emoji markers → emit the §6 `AgentEvent`s via the extracted `sse.ts` encoder.                                                                    |
| `CAS core/streaming.ts:79-85, 114-120`      | **DELETE**                                    | `isEphemeralContent` emoji filter + `<sharelyai_start>` in-band ID marker — replaced by typed `tool_call_*` events and `message_end`.                                            |
| `CAS core/fetcher.ts`, `auth.ts`, `utils/*` | **Port**                                      | Retrying fetcher, header sanitization, auth extraction, env load, PII-safe logger.                                                                                               |
| `CAS core/knowledge.ts`                     | **DELETE**                                    | Auto-RAG path removed; survives only as the `@sharelyai/tools` extraction above.                                                                                                 |
| `CAS core/types.ts:31-49`                   | **DELETE**                                    | `AgentConfig`/`CreateAgentArgs`/`AgentStreamInput` — LangChain-coupled, replaced by `Handler`.                                                                                   |

**Net:** HTTP/auth/proxy port verbatim. Protocol, tools, and SSE encoder are _extracted from `sharelyai-be`_ (low risk — production code). Persistence is ported but **retargeted** to the agent-threads model. The LangChain coupling, auto-RAG, and marker-streaming are deleted.

---

## 9. Implementation phases

### Phase 0 — Repo bootstrap _(~2 days)_

- [x] `sharely-server-sdk` repo; Turborepo + workspaces; shared `@sharelyai/tsconfig`. _(CI + Changesets deliberately omitted per repo-owner decision.)_

### Phase 1 — Protocol + server runtime _(2 weeks · Spec 02 Phase 1)_

- [x] `@sharelyai/protocol`: §6 types extracted; `Handler`/`AgentInput`/`AgentContext` added; `SharelyAPIClient` + `TraceSpan` stubs in place.
- [x] `@sharelyai/server`: HTTP/auth/proxy ported; `sse.ts` encoder extracted; persistence retargeted to the agent-threads API; `AbortController` → `signal` wired; auto-RAG/LangChain/PII-log/marker code deleted. 516 LOC after token validation was added.
- [x] **Backend coordination:** `thread.agentServerId` dispatch branch landed in `sharelyai-be`'s `chat`.
- **Acceptance:** `packages/server/examples/smoke.mjs` 5/5 (event sequence, persistence, token validation called once, bad token → 401).

### Phase 2 — Two adapters _(3 weeks · Spec 02 Phase 2)_

- [x] **Conformance harness** at `packages/conformance/` (`@sharelyai/conformance`, private).
- [x] `@sharelyai/adapter-vercel-ai`: `streamText` events → `AgentEvent`; abort bridge; history conversion; `@sharelyai/tools` re-exported in `ai`'s `tool()` shape.
- [x] `@sharelyai/adapter-temporal`: `fromTemporal({ client, workflowType, taskQueue })`; `emitAgentEvent`; disconnect cancels workflow.
- [x] Both pass the conformance harness.

### Phase 3 — Pattern C reference snippets + adapter examples _(done)_

- [x] `examples/` Pattern C: `anthropic-sdk-direct`, `openai-agents-sdk`, `langgraph`, `raw-streaming`.
- [x] `examples/` adapter-backed: `adapter-vercel-ai`, `adapter-temporal`.
- Each is handler + server + runnable smoke + README; all 12 .ts files type-check clean via `examples/tsconfig.check.json`; all 6 smokes green.

---

## 10. Cross-spec & cross-repo dependencies — do not start blind

| Need                                          | Comes from                                             | Phase 1 mitigation                                                                                   |
| --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Ratified `AgentEvent` union                   | **Spec 01** — must match `sharelyai-be/agent/types.ts` | Extract from `types.ts` directly; treat Spec 01 divergences as spec bugs.                            |
| `SharelyAPIClient` type                       | **Spec 04** (`@sharelyai/api`)                         | Stub interface in `@sharelyai/protocol`.                                                             |
| `TraceSpan` type                              | **Spec 06** — builds on `agent/log.ts`                 | Stub interface.                                                                                      |
| `searchKnowledge` internals                   | **Spec 03** + `sharelyai-be/agent/tools/*`             | Extract existing tools; retrieval quality is Spec 03's problem.                                      |
| **`thread.agentServerId` dispatch in `chat`** | **`sharelyai-be` repo**                                | Net-new backend work — without it, customer servers are never invoked. Co-own with backend team.     |
| **`sharelyai-be` OpenAPI spec**               | **`sharelyai-be` repo**                                | Required for `@sharelyai/api`. Author it, or hand-write a client for the §4/§5.5 route subset.       |
| **Versioned `sharelyai-be` surface**          | **`sharelyai-be` repo + Spec 04**                      | `sharelyai-be` mixes `/v1/...` and unversioned routes; needs a ≥12-month-window contract.            |
| Widget SSE consumption                        | `jswebcontrol` repo                                    | The widget already consumes `sharelyai-be`'s SSE protocol — confirm it is event-vocabulary-complete. |

---

## 11. What `@sharelyai/server` owns (customers never reimplement)

- **HTTP:** Express + CORS + 10 MB body limits; the agent-turn entrypoint; catch-all proxy to `sharelyai-be`; goals shim; `/test` health.
- **Auth proxy:** extract + forward the bearer token unchanged; reject missing auth before invoking the `Handler`. Never mints/validates tokens — `sharelyai-be` does.
- **Persistence:** create/locate `agentThread`, persist user + assistant `agentMessage` rows (with `thinkingSteps`/`toolCalls`/`sources`/`tokenUsage`), surface the final message ID via `message_end`.
- **Streaming:** SSE headers, `AgentEvent` encoding (extracted `sse.ts`), client-disconnect handling.
- **Platform integration:** retrying fetcher, header sanitization, request-scoped `AgentContext` with a `sharelyai-be`-scoped `@sharelyai/api` client.
- **Operational:** env load/validation, PII-safe logging, trace span lifecycle.

## 12. What adapters must NOT do

Define new event types · implement tools · invent cancellation primitives · persist messages · retry/fallback · implement tracing · touch auth, RBAC, orchestration, model choice, prompts, tool composition · import `sharelyai-be` internals. Adapters are **narrow translators**.

---

## 13. Definition of done (v1)

- [ ] All six packages publish under `@sharelyai/*` with semver + changelogs.
- [ ] A customer wires an agent in ~50 lines (Vercel AI) / ~30 lines (raw `Handler`).
- [ ] Both adapters pass the conformance harness; their output is interchangeable with `runAgentLoop`'s.
- [ ] `@sharelyai/server` is ≤500 LOC and emits the §6 protocol via the extracted `sse.ts` encoder.
- [ ] `@sharelyai/protocol` and `@sharelyai/tools` are the single shared source of truth with `sharelyai-be` (no drift).
- [ ] `sharelyai-be`'s `chat` routes to a customer server when `thread.agentServerId` is set.
- [ ] Conversations persist to `agentThread`/`agentMessage`.
- [ ] No prompts or message history are ever logged.
- [ ] `@sharelyai/api` is generated from a published `sharelyai-be` OpenAPI spec; the SDK imports no `sharelyai-be` source.
- [ ] Existing `customagentserver` forkers keep running via the `legacy` shim.

---

## 14. Open questions

From Spec 02:

1. Temporal adapter scaffolding — how much worker setup does the CLI generate? _(Recommend: a working worker template.)_
2. Should `AgentContext.api` auto-include the tenant + role filter? _(Recommend: yes.)_
3. Temporal disconnect-mid-stream UX — confirm with a design partner.
4. Community adapter scope — npm `@sharely-community/*` vs a curated GitHub list. _(Recommend: GitHub list first.)_

Raised by the `sharelyai-be` agent runtime: 5. **Which endpoint does `@sharelyai/server` v1 align to?** Spec 02 says it intercepts `POST /spaces/:spaceId/messages` (the CAS legacy path). But `sharelyai-be`'s agent runtime uses `POST /workspaces/:workspaceId/agent/threads/:threadId/chat` with the richer `agentMessage` model. _Recommendation: align to `/agent/threads/.../chat`; treat the legacy path as the `legacy` shim only._ 6. **Who owns the `thread.agentServerId` dispatch branch in `sharelyai-be`'s `chat`?** It does not exist yet and blocks the whole customer-hosted model. 7. Should `@sharelyai/protocol` and `sharelyai-be/agent/types.ts` share one published package (i.e. `sharelyai-be` consumes `@sharelyai/protocol`), to structurally prevent protocol drift? 8. Does `sharelyai-be` expose an OpenAPI spec today? If not, who authors it, and is `@sharelyai/api` generated in this repo's CI or published from `sharelyai-be`? 9. Should the SDK pin a minimum `sharelyai-be` API version and fail fast on mismatch?
