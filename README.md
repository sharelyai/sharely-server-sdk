# Sharely Server SDK

> **Status / handoff document.** This README is the working-context summary of the SDK — what is built, what was decided, what is verified, and what comes next. It is written to be picked up by another engineer or model mid-build. The authoritative plan is [TASK.md](TASK.md); this file records reality against it.

---

## 1. What this is

The customer-facing surface for building a **Sharely-compatible agent server**. A Sharely workspace runs its agent in one of three places, all dispatched by the Sharely platform (`sharelyai-be`) and all speaking the **same SSE event protocol**:

1. **Sharely-hosted default loop** — the built-in Anthropic agentic loop (`runAgentLoop`).
2. **Sharely-hosted agentflow** — visual no-code flows (`runAgentflowChat`).
3. **Customer-hosted agent server** — *this SDK*. The customer brings agent logic; the SDK owns HTTP, auth, persistence, and streaming.

The SDK is a **refactor of proven code into published packages** — the wire protocol and tool definitions are *extracted* from `sharelyai-be`'s production agent runtime, not designed fresh.

This is a Turborepo monorepo (`packages/*` workspaces, npm). Sibling repos used as source/targets live at `../sharelyai-be` (the backend), `../customagentserver` (the legacy fork-the-template model), `../agentflow`, `../jswebcontrol`.

---

## 2. Phase status (vs TASK.md §9)

| Phase | State | Notes |
|---|---|---|
| **0 — Bootstrap** | ✅ Done | Turborepo + workspaces + shared tsconfig. **CI and Changesets deliberately omitted** per repo-owner decision. |
| **1 — Protocol + server runtime** | ✅ Done in-repo | `@sharely/protocol`, `@sharely/server`, `@sharely/tools`, `@sharely/api` built + green. Backend dispatch branch landed in `sharelyai-be`. |
| **2 — Conformance harness + 2 adapters** | ✅ Done | `@sharely/conformance` + `@sharely/adapter-vercel-ai` + `@sharely/adapter-temporal`, all passing conformance. |
| **3 — Pattern C examples** | ⬜ Not started | `examples/`: anthropic-sdk-direct, openai-agents-sdk, langgraph, mastra, raw-streaming. |
| **4 — Customer migration** | ⬜ Not started | `@sharely/server/legacy` shim + `sharely migrate` codemod + `customagentserver` README rewrite. |
| **5 — CLI integration** | ⬜ Not started | `sharely init` scaffolder (Spec 05). |
| **6 — Sunset the fork** | ⬜ Not started | Retire the fork-the-template model after one shim release. |

---

## 3. Packages

All live under `packages/`, all build green via `npx turbo run build`.

| Package | LOC | State | Purpose |
|---|---:|---|---|
| `@sharely/protocol` | 269 | ✅ Ready | Wire types — `AgentEvent` union, `Handler`/`AgentInput`/`AgentContext`, domain + tool types. No runtime code. |
| `@sharely/server` | 516 | ✅ Ready | Express runtime — HTTP, CORS, rate limit, token validation, SSE encoding, persistence, catch-all proxy. |
| `@sharely/api` | 242 | ✅ Ready | Typed client to the `sharelyai-be` Backplane + `tokens.validate()`. Hand-written; OpenAPI-generated later. |
| `@sharely/tools` | 169 | ✅ Ready | The 7 first-party Sharely tool **definitions** + pluggable executor registry. |
| `@sharely/adapter-vercel-ai` | 263 | ✅ Ready | Vercel AI SDK `streamText` ⇄ `AgentEvent` translator. |
| `@sharely/adapter-temporal` | 222 | ✅ Ready | Temporal workflow ⇄ `AgentEvent` translator (`fromTemporal` + `emitAgentEvent`). |
| `@sharely/conformance` | 322 | ✅ Ready | **Private.** Event-stream validator + golden scenarios + handler runner. |

> Note: `@sharely/server` is 516 LOC — slightly over TASK.md §3's ≤500 budget after token validation was added. The budget predates the token-validation requirement.

---

## 4. Architecture / key concepts

### The `Handler` contract
Every agent — adapter-produced or raw (Pattern C) — is one function shape:
```ts
type Handler = (input: AgentInput) => AsyncIterable<AgentEvent>;
```
The `Handler` yields typed `AgentEvent`s; `@sharely/server` owns everything else.

### The wire protocol (`@sharely/protocol`)
`AgentEvent` is a discriminated union of 11 in-band events: `message_start`, `thinking_start`/`_delta`/`_end`, `tool_call_start`/`_end`, `content_delta`, `content_end`, `sources`, `message_end`, `error`. The server adds a 12th wire-only event, `done`, and wraps every event with a `{ threadId, messageId }` envelope. Extracted verbatim from `sharelyai-be/src/controller/agent/types.ts`.

### Request flow
```
WebControl ──▶ sharelyai-be  POST /workspaces/:wsId/agent/threads/:threadId/chat   (user JWT)
                   │
                   └─ thread.agentServerId set?
                          │ yes → proxyToAgentServer (streams SSE straight through)
                          ▼
              @sharely/server  POST /agent/threads/:threadId/chat
                   1. validate the user token → POST /v1/workspaces/:wsId/api-authenticated
                   2. persist user message    → Backplane
                   3. run the Handler, encode AgentEvents as SSE
                   4. persist assistant message (thinkingSteps/toolCalls/sources/tokenUsage)
                   5. emit `done`
```

### Auth model
- The customer's `@sharely/server` is configured with a **`workspaceApiKey`**.
- Incoming requests carry a **user JWT** in `Authorization`. The server **validates** it via `POST /v1/workspaces/:wsId/api-authenticated` (caller-auth = `workspaceApiKey`, body = `{ token: <user JWT> }`), deriving `userId`/`temporalUserId`/`roleId`.
- All platform calls (Backplane persistence, RAG, validation) use `workspaceApiKey` — never the user JWT.
- RBAC and token minting stay in `sharelyai-be`; the SDK only validates + forwards.

---

## 5. Changes already made in `sharelyai-be` (cross-repo)

The customer-hosted path required backend work. All committed and typecheck-clean (`etsc` + `tsc --noEmit`):

- **`prisma/schema.prisma`** — new `AgentServer` model `{ id, name, url, status, metadata, workspaceId, ... }`; `AgentThread.agentServerId` is now a real FK; `Workspace.agentServers` reverse relation; indexes added.
- **`src/controller/agent/user.ts`** — `chat` dispatch branch: when `thread.agentServerId` is set + the server is `ACTIVE`, proxy the turn to the customer server and return.
- **`src/controller/agent/agent-server-proxy.ts`** (new) — streams the customer server's SSE response straight back, with abort handling + structured logs.
- **`src/controller/agent/backplane.ts`** — `AgentServer` CRUD (`create`/`list`/`get`/`update`/`delete`, soft-delete).
- **`src/utils/schemas.ts`** — `AGENT_BACKPLANE_AGENT_SERVER_CREATE` / `_UPDATE` yup schemas.
- **`src/index.ts`** — 5 routes under `/v1/workspaces/:workspaceId/agent/servers`, guarded by `isApiKeyAuthenticated`.

**⚠️ The Prisma migration was NOT applied** — only `prisma generate` was run (repo-owner instruction). Before the dispatch path works against any real DB: `cd ../sharelyai-be && npx prisma migrate dev --name add_agent_server`.

---

## 6. Key decisions & deviations from TASK.md

- **`conformance` is `packages/conformance`**, not the repo-root `conformance/` in TASK.md §2 — keeps workspace resolution clean (adapters depend on it as a devDependency). Private (`"private": true`), not published.
- **`done` is wire-only.** The `Handler` emits `message_start … message_end`; the server appends `done`. `AgentEvent` does not include `done`.
- **`@sharely/api` is hand-written**, covering the Backplane route subset (TASK.md §10 explicitly permits this until `sharelyai-be` ships an OpenAPI spec — §14 Q8).
- **`@sharely/tools` ships definitions only.** The 7 tools have no default `execute` (the upstream ones hit Prisma/Pinecone directly and can't ship publicly). Executors plug in via `createTools({ ... })`.
- **Token validation was added** — TASK.md §4/§11 said "never validates tokens", but the repo owner overrode this. On by default, disable with `validateIncomingToken: false`.
- **Adapters are typed structurally** — they do not import `ai` or `@temporalio/*`, so they survive framework major-version churn.
- **Inter-package deps use `"*"`** (repo-owner instruction) — not pinned semver ranges.
- **No CI, no Changesets** — repo owner publishes manually with `npm publish`.
- The shared TS config is the published **`@sharelyai/tsconfig`** (note the `ai` — different scope from this SDK's `@sharely/*`); `strict` is `false` there.

---

## 7. What is verified vs. unverified

**Verified (automated):**
- `npx turbo run build` → 7/7 packages compile.
- `node packages/server/examples/smoke.mjs` → 5/5 (event sequence, user+assistant persistence, token validation called once, bad token → 401).
- `node packages/adapter-vercel-ai/examples/conformance.mjs` → 5/5 (4 scenarios + abort bridge).
- `node packages/adapter-temporal/examples/conformance.mjs` → 6/6 (4 scenarios + sink round-trip + abort cancels workflow).
- `sharelyai-be` compiles (`etsc` + `tsc --noEmit`).

**NOT verified:**
- Nothing has run against a **live `sharelyai-be`** or **WebControl**. All smokes use in-process mocks.
- The Temporal adapter has **never run against a real Temporal cluster** — only a fake client. Polling/cursor/cancel logic is exercised; real `@temporalio/client` query semantics are not.
- The `sharelyai-be` dispatch branch is **untested at runtime** — the `AgentServer` table doesn't exist until the migration is applied.

---

## 8. Blockers / pending (need repo-owner action)

1. **npm publish.** `@sharely/*` is an unclaimed scope. The owner is logged in (`andresmontoya`) but asked to publish manually. Publish order: `@sharely/protocol` first (others depend on it), then `tools`, `api`, `server`, adapters. `@sharely/conformance` is private — do not publish.
2. **Prisma migration** in `sharelyai-be` — see §5.
3. **Drift prevention** (TASK.md §13 DoD) — once `@sharely/protocol` + `@sharely/tools` are published, rewrite `sharelyai-be/src/controller/agent/types.ts` and `tools/*` to re-export from the published packages instead of duplicating. ~10-line change; blocked on publish.

---

## 9. Next steps (Phases 3–6)

**Phase 3 — Pattern C reference examples** (`examples/`, ~1 week)
Snippet-style (not packages) showing the raw `Handler` with: Anthropic SDK direct, OpenAI Agents SDK, LangGraph, Mastra, raw streaming. Each is a `Handler` wired into `createSharelyServer`.

**Phase 4 — Customer migration** (~2 weeks)
- `@sharely/server/legacy` shim — keep existing `customagentserver` forkers running (legacy `POST /spaces/:spaceId/messages` path, plain-text streaming).
- `sharely migrate` codemod.
- Rewrite the stale `customagentserver/README.md`.

**Phase 5 — CLI** (`sharely init`, ~1 week)
Scaffolder with templates: Vercel AI–backed, Temporal-backed, raw `Handler`, blank.

**Phase 6 — Sunset the fork**
After one minor release with the shim, retire the fork-the-template model.

**Also outstanding** (not phase-bound):
- READMEs exist for `protocol`, `server`, `api`, `tools` — none yet for the two adapters or `conformance`.
- No unit tests beyond the `.mjs` smokes; no test runner is wired.
- The auth-coupling note in §4 assumes the customer server has a real `workspaceApiKey` — confirm the platform issues these per workspace.

---

## 10. Build & test

```bash
npm install                                            # all workspaces
npx turbo run build                                    # build 7 packages
node packages/server/examples/smoke.mjs                # server acceptance smoke
node packages/adapter-vercel-ai/examples/conformance.mjs
node packages/adapter-temporal/examples/conformance.mjs
```

Each package: `build` (`tsc`), `typecheck` (`tsc --noEmit`), `clean`. TS config extends `@sharelyai/tsconfig/base.json`.

---

## 11. Repo layout

```
sharely-server-sdk/
├── packages/
│   ├── protocol/            @sharely/protocol            — wire types
│   ├── server/              @sharely/server              — Express runtime
│   ├── api/                 @sharely/api                 — Backplane client
│   ├── tools/               @sharely/tools               — tool definitions
│   ├── adapter-vercel-ai/   @sharely/adapter-vercel-ai   — Vercel AI translator
│   ├── adapter-temporal/    @sharely/adapter-temporal    — Temporal translator
│   └── conformance/         @sharely/conformance         — test harness (private)
├── turbo.json
├── TASK.md                  the implementation plan (source of truth)
└── README.md                this file
```

Per-package READMEs: [protocol](packages/protocol/README.md) · [server](packages/server/README.md) · [api](packages/api/README.md) · [tools](packages/tools/README.md).

---

## License

MIT
