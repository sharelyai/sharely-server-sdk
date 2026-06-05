# Sharely Server SDK — Open-Source GA Readiness Tasks

> **Audience:** Andres (developer on this repo).
> **Goal:** Promote the Sharely Server SDK from its current public‑alpha state to a
> **public, GA‑quality, npm‑installable** open‑source release.
> **Source:** Findings from a first‑hand code audit (June 2026) of `packages/*`,
> manifests, tsconfigs, `.env.example`s, and the README.

---

## ✅ Progress status — updated 2026-06-05

Live status of every task below. "Done" items are implemented and the monorepo
**builds + typechecks green (18/18)**. "Tests deferred" means the code is done
but the acceptance-criteria test waits on **P0-3** (no test runner is wired yet).

### Done

- **P0-1** Vendor tsconfig — _variant:_ not vendored into this repo. Fixed at
  source in `../sharelyai-mono/packages/tsconfig` (added Apache-2.0 `license` +
  `repository` + `description`), published as `@sharelyai/tsconfig@0.0.1`, and
  all workspaces repointed to `^0.0.1`. Lockfile normalized (stale phantom
  `apps/live-demo` workspace pruned).
- **P0-4-bug** `'metadata_update'` added to `KNOWN_TYPES`. _(test deferred → P0-3)_
- **P0-5** Internal URLs scrubbed — the 4 `.env.example`s + the comment, **plus
  2 extra `fly.dev` leaks** found in `packages/server/README.md` and
  `packages/api/README.md`.
- **P0-6** Apache-2.0: root `LICENSE` + `NOTICE` (Sharely.ai Inc.), every
  `package.json` relicensed MIT → Apache-2.0, README license line updated.
- **P0-7** README rewritten as user-facing docs (install, `Handler` contract,
  12-event protocol, config table, packages, `examples/` + `apps/` live demos,
  License). Old handoff doc preserved verbatim at `docs/internal-handoff.md`;
  broken/private references removed; event count corrected to 12.
- **P1-2** Expired-JWT handling — decode `exp`, refresh ~60s before expiry,
  bounded fallback TTL. _(401-retry fallback NOT added; test deferred → P0-3)_
- **P1-3** Safe CORS default — `origin: false` + loud startup warn when
  `allowedOrigins` is unset. _(test deferred → P0-3)_
- **P1-4** Generic client-facing 5xx + SSE `error` event; full error logged
  server-side; 4xx messages preserved. _(test deferred → P0-3)_
- **P1-5** `enableProxy` flag (default `true`, backward-compatible) + security-
  boundary docs in `packages/server/README.md`.
- **P1-6** _variant:_ **NO Changesets** (publishing is manual). Manual,
  dependency-ordered release flow + GA version recommendation (`0.0.x → 0.1.0`)
  documented in new `CONTRIBUTING.md`.
- **P2-1** Root manifest cleaned (real `description`/`author`, bogus
  `main: index.js` removed). _Note: `private: true` kept — root-private does not
  block publishing the child packages._
- **P2-2** `engines.node >= 20` on root + all 7 packages.
- **P2-3** npm metadata (`repository.directory`, `homepage`, `keywords`) on all
  7 packages.
- **P2-4** Pluggable `Logger` option threaded through
  createServer/fetcher/context/pipeline; `defaultLogger` exported; `TraceSpan`-
  is-a-stub note added to the server README.
- **P2-5** `installGracefulShutdown` helper exported from `@sharelyai/server`,
  wired into all 4 demos (Temporal demos also close their connection).
- **P2-6** All 4 demos confirmed `private: true`; Express 5 assessment written
  at `docs/express-5-assessment.md` (report only — the one real blocker is the
  `'*'` route strings).

### Remaining

- **P0-3** Add a test suite (Vitest). Absorbs the deferred tests for P0-4-bug,
  P1-2, P1-3, and P1-4.

### Won't do

- **P0-2** Turn on `strict: true` and fix the fallout. _Now a republish of
  `@sharelyai/tsconfig` → 0.0.2 (or override `strict` per-package) since the
  setting lives in the published base config._
- **P1-1** `"*"` → caret ranges — explicitly skipped (DO NOT DO).
- **P0-4** Add CI (`.github/workflows/ci.yml`).

### Open follow-ups / decisions

- **P1-2** — add the downstream-401 invalidate-and-retry fallback? (proactive
  `exp` refresh already covers the stated mid-life-expiry bug).
- **Release note** — the P1-3 CORS default is a behavior change for any consumer
  relying on the old reflect-any-origin behavior; call it out when bumping.

---

## How to use this document

Each task below has:

- **Severity** — P0 (GA blocker), P1 (high), P2 (polish).
- **Why it matters** — the problem, with `file:line` references.
- **Acceptance criteria** — how you know it's done.
- **Claude prompt** — a ready‑to‑paste prompt for Claude Code. Run it from the
  repo root (`sharely-server-sdk/`). Read Claude's plan before approving edits;
  these are starting points, not blind auto‑applies.

**Suggested order:** do all P0s first (several are quick wins), then P1, then P2.
Realistic effort to GA: **~2–3 weeks**, with the test suite (P0‑3) and the
`strict` migration (P0‑2) as the long poles.

**Important context — this SDK is already on public npm.** All 7 packages are
published (`@sharelyai/server@0.0.5`, `@sharelyai/protocol@0.0.3`, …). So this is
a _promotion of an existing release_, not a first publish. That affects two
tasks specifically: the `"*"` dependency wiring (P1‑1) and versioning (P1‑6) are
already baked into what consumers pull today — changing them is a coordinated
release, not a free edit.

---

## Quick‑win batch (do these first — under a day total)

P0‑5 (scrub URLs), P0‑6 (LICENSE), P0‑1 (vendor tsconfig), P0‑4‑bug
(`metadata_update` validator one‑liner), and the root‑manifest cleanup (P2‑1)
are all small and unblock everything else. A single combined prompt is provided
at the end of the P0 section.

---

# 🔴 P0 — GA blockers

## P0‑1 — Vendor the shared TypeScript config into the repo

**Why it matters.** Every package's tsconfig is just
`{"extends": "@sharelyai/tsconfig/base.json"}` (e.g. `packages/server/tsconfig.json`).
`@sharelyai/tsconfig` is a **separate npm package that is not in this repo**. The
published artifact is version `0.0.0` with **no `license`, no `repository`, no
README** — just `package.json` + `base.json`. Problems:

- A contributor cloning the repo cannot see or modify the compiler settings —
  they live in an out‑of‑tree black box.
- An Apache‑2.0 repo whose build config is an **unlicensed** external dependency
  is a provenance problem.
- It forces lock‑step publishing of that package forever.

**Acceptance criteria.**

- The TS base config lives **inside this repo** (either a `packages/tsconfig`
  workspace package, or a root `tsconfig.base.json`).
- No package depends on the external `@sharelyai/tsconfig` anymore.
- `npx turbo run build` and `typecheck` still pass.
- The external `@sharelyai/tsconfig` devDependency is removed from the root and
  all packages.

**Claude prompt.**

```
The packages in this repo all extend an external npm package "@sharelyai/tsconfig"
for their TypeScript config (see packages/*/tsconfig.json -> extends
"@sharelyai/tsconfig/base.json"). That package is not in this repo and is
unlicensed, which is a problem for an Apache-2.0 open-source release.

Vendor the config into the repo as a workspace package at packages/tsconfig:
- Create packages/tsconfig/package.json (name "@sharelyai/tsconfig", private or
  publishable — recommend keeping it publishable with an Apache-2.0 license field
  + repository field so the extends path still works for published consumers).
- Move the base.json contents in (fetch the current published base.json if you
  need it: `npm pack @sharelyai/tsconfig` and read package/base.json).
- Point every packages/*/tsconfig.json at the workspace version via the
  workspace protocol, and update root + per-package devDependencies accordingly.
- Run `npx turbo run build` and `npx turbo run typecheck` and fix anything that
  breaks.

Do NOT change the actual compiler options yet (strict stays as-is — that's a
separate task). Show me the diff before applying.
```

---

## P0‑2 — Turn on TypeScript `strict` mode and fix the fallout

**Why it matters.** The shared base config has `"strict": false`. For an SDK that
handles auth tokens, JWT exchange, and message persistence, shipping with strict
off means null‑safety and implicit‑`any` bugs go undetected. Highest‑leverage
correctness fix in the whole list. Expect real fixups (e.g. the `reduce()`
accumulator in `packages/server/src/pipeline.ts` leans on loose typing).

**Do P0‑1 first** so the config is in‑repo and editable.

**Acceptance criteria.**

- `strict: true` in the vendored base config.
- `npx turbo run build` and `typecheck` pass across all packages.
- No new `any`, `as any`, or `@ts-ignore` added to paper over errors — fix the
  underlying types.

**Claude prompt.**

```
Enable TypeScript strict mode for the whole SDK. In the vendored base tsconfig,
set "strict": true (and remove any individual relaxations that contradict it).

Then run `npx turbo run typecheck` and fix every resulting error properly —
real type fixes, NOT `any` / `as any` / `@ts-ignore` suppressions. Pay special
attention to:
- packages/server/src/pipeline.ts (the reduce() accumulator and message
  assembly)
- packages/server/src/createServer.ts (the auth/role-exchange flow,
  user_metadata access)
- packages/api/src/client.ts and transport.ts (response typing)
- the adapters' structural stream typing

Work package by package in dependency order (protocol -> api/tools -> server ->
adapters -> conformance). Show me the diff per package and keep going until
`npx turbo run build` is fully green.
```

---

## P0‑3 — Add an automated test suite

**Why it matters.** There is **zero automated test coverage**. The only
verification is hand‑run `.mjs` smoke scripts in `examples/*/smoke.mjs`. The
`turbo.json` `test` task exists but no package implements it. For a GA SDK doing
auth + persistence + a wire‑protocol contract, this is the single biggest gap.

**Highest‑value targets** (in priority order):

1. `packages/conformance/src/validate.ts` — the protocol invariant checker.
   (Note: it currently has a bug — see P0‑4‑bug — write the test that catches it.)
2. `packages/server/src/createServer.ts` — auth/role‑exchange branching, token
   validation rejection paths, the `X-Sharely-Message-Id` handling.
3. `packages/server/src/fetcher.ts` — retry/backoff, timeout, header sanitization.
4. `packages/server/src/pipeline.ts` — the event `reduce()` → assistant message.
5. Each adapter's stream mapping (`adapter-vercel-ai/src/stream.ts`,
   `adapter-temporal`).

**Acceptance criteria.**

- A test runner is wired (recommend **Vitest** — fast, ESM‑native, matches the
  `webcontrol` repo).
- Each package above has a `test` script; `npx turbo run test` runs them all.
- The conformance, fetcher, and pipeline logic have real unit tests; adapters
  have at least golden‑stream tests via `@sharelyai/conformance`.
- Tests pass in CI (see P0‑4).

**Claude prompt.**

```
This SDK has no automated tests — only manual .mjs smokes in examples/. Set up a
proper test suite using Vitest (ESM, matches our other repos).

1. Add vitest as a dev dependency and wire a "test" script in each package that
   has logic to test, so `npx turbo run test` runs everything.
2. Write unit tests, prioritizing:
   - packages/conformance/src/validate.ts: cover every invariant
     (message_start ordering, unmatched thinking/tool ids, content_end rules,
     unterminated streams) AND every valid AgentEvent type including
     metadata_update. (You will likely find validate.ts rejects metadata_update —
     if so, the test SHOULD fail; flag it, I have a separate task to fix the
     source.)
   - packages/server/src/fetcher.ts: retry on 5xx, no-retry on 4xx, timeout,
     header sanitization (DROPPED set, sec-ch-* stripping), body serialization.
   - packages/server/src/pipeline.ts: feed event sequences through reduce() and
     assert the assembled StoreMessageInput (content, thinkingSteps, toolCalls,
     sources aggregation, tokenUsage).
   - packages/server/src/createServer.ts: validation rejections (missing
     threadId/message/auth, invalid bearer), and the role-exchange caching logic
     (mock fetch). Use supertest against the Express app.
   - adapter-vercel-ai and adapter-temporal: golden-stream tests that run the
     adapter output through validateEventStream from @sharelyai/conformance.
3. Make `npx turbo run test` green.

Show me the test plan (what files, what cases) before writing them all.
```

---

## P0‑4 — Add CI (build + typecheck + test + conformance)

**Why it matters.** No `.github/workflows`. The README explicitly notes CI was
"deliberately omitted" — acceptable for alpha, **not for GA**. Anyone can land a
change that breaks the build or the protocol with no gate.

**Acceptance criteria.**

- `.github/workflows/ci.yml` runs on PR and on push to the main branch.
- Steps: install (npm, with cache), `npx turbo run build`, `typecheck`, `test`,
  and run the example smokes.
- Pinned Node version matching the `engines` floor (see P2‑2); npm from
  `packageManager`.
- Badge added to the (rewritten) README.

**Claude prompt.**

```
Add a GitHub Actions CI workflow at .github/workflows/ci.yml for this npm +
Turborepo monorepo. It should run on pull_request and on push to the default
branch, and:
- check out, set up Node (use the version from the engines field / our floor,
  with actions/setup-node caching for npm),
- npm ci,
- npx turbo run build,
- npx turbo run typecheck,
- npx turbo run test,
- run the example smokes (node examples/*/smoke.mjs).
Keep it a single job with a sane matrix only if cheap. Make it fail fast and
cache Turbo's local cache. Then add a CI status badge to README.md.
```

---

### P0‑4‑bug — Fix the `metadata_update` gap in the conformance validator (1‑line, do it now)

**Why it matters.** `packages/conformance/src/validate.ts:8` defines `KNOWN_TYPES`
**without `'metadata_update'`**, but the protocol defines `MetadataUpdateEvent`
(`packages/protocol/src/events.ts:80`) **and the Vercel adapter emits it**
(`packages/adapter-vercel-ai/src/stream.ts:126`). So validating a real adapter
stream that carries per‑tool metadata fails with _"not a known AgentEvent type."_
Your contract‑enforcement tool rejects conformant streams.

**Acceptance criteria.** `metadata_update` is in `KNOWN_TYPES`; a conformance
test asserts a stream containing it validates `ok: true`.

**Claude prompt.**

```
In packages/conformance/src/validate.ts, the KNOWN_TYPES set is missing
'metadata_update', even though it's a valid AgentEvent (packages/protocol/src/
events.ts) emitted by adapter-vercel-ai. Add 'metadata_update' to KNOWN_TYPES so
conformant streams aren't rejected. There's no ordering constraint on it (treat
like 'sources'). Add/extend a test asserting a stream with a metadata_update
event passes validation.
```

---

## P0‑5 — Scrub leaked internal infrastructure URLs

**Why it matters.** A private Azure Front Door dev endpoint is hardcoded in **4
files**, and a second internal host appears in a comment. These are contained to
the repo today (the `apps/*` demos aren't published to npm) but go public the
instant this repo lands on GitHub.

- `apps/live-demo-vercel/.env.example:1`
- `apps/live-demo-temporal/.env.example:2`
- `apps/live-demo-temporal-ai-sdk/.env.example:2`
- `apps/live-demo-langgraph/.env.example:2`
  → `SHARELY_API_URL=https://sharelyai-be-fd-endpoint-development…z02.azurefd.net`
- `examples/anthropic-sdk-direct/server.ts:7` → comment referencing
  `https://sharely-develop.fly.dev`

**Acceptance criteria.** No `azurefd.net` / `fly.dev` / other internal hostnames
anywhere in the repo. Placeholders use the public API URL or an obvious dummy.

**Claude prompt.**

```
Remove all internal Sharely infrastructure URLs from the repo before it goes
public. Specifically:
- In all apps/*/.env.example files, replace the SHARELY_API_URL value
  (the *.azurefd.net dev endpoint) with the public default
  `https://api.sharely.ai` (or a clearly-placeholder value with a comment telling
  the user to set their own).
- In examples/anthropic-sdk-direct/server.ts, replace the
  `https://sharely-develop.fly.dev` reference in the comment with
  `https://api.sharely.ai`.
Then grep the whole repo (excluding node_modules/dist) for "azurefd.net",
"fly.dev", "windows.net" and any other non-public hostnames and confirm none
remain. Show me what you changed.
```

---

## P0‑6 — Add the license: **Apache‑2.0** (LICENSE + NOTICE, relicense from MIT)

**Why it matters.** There is **no `LICENSE` file** in the repo, GitHub won't
detect a license, and it's the conventional GA bar. The chosen license is
**Apache‑2.0** (consistent with the `webcontrol` decision).

> **⚠️ This is a relicense, not a first license.** Every `package.json` currently
> declares `"license": "MIT"`, and all 7 packages are **already published to npm
> as MIT**. Relicensing going forward is fine when Sharely owns the copyright,
> but note:
>
> - Versions already on npm (`@sharelyai/server@0.0.5`, etc.) **remain MIT** for
>   those specific versions — you can't retroactively change them. New versions
>   ship Apache‑2.0.
> - Confirm contributor rights. The published maintainer list includes two
>   non‑Sharely email accounts; make sure all contributions are
>   company‑owned/assigned (employment or contractor IP terms) before relicensing.
>   If unsure, check with whoever owns legal.

**Acceptance criteria.**

- Root `LICENSE` file containing the full **Apache‑2.0** text.
- Root `NOTICE` file (copyright Sharely.ai Inc., 2026) per Apache convention.
- **Every** `package.json` `"license"` field changed from `"MIT"` to
  `"Apache-2.0"` (all packages + root + the vendored tsconfig from P0‑1).
- No stray "MIT" references remain in README/docs.

**Claude prompt.**

```
We're licensing this SDK under Apache-2.0 (it currently declares MIT everywhere
and is already published to npm as MIT — this is a relicense going forward).

1. Add the full Apache License 2.0 text as a root LICENSE file.
2. Add a root NOTICE file: "Sharely Server SDK / Copyright 2026 Sharely.ai Inc."
   (confirm the exact legal entity name with me if unsure).
3. Change the "license" field from "MIT" to "Apache-2.0" in EVERY package.json:
   the root, all packages/* (including the vendored tsconfig package if it
   exists), and apps/*.
4. Grep the repo (README, docs, per-package READMEs) for "MIT" and update any
   prose that names the license to "Apache-2.0".
Show me the full diff. Do NOT attempt to alter already-published npm versions —
this only affects future publishes.
```

---

## P0‑7 — Rewrite the README as user‑facing documentation

**Why it matters.** The current README is an **internal handoff document** —
line 3 says so explicitly. It leaks material a customer should never see and has
broken commands:

- Sibling **private repo paths**: `../sharelyai-be`, `../customagentserver`,
  `../agentflow`, `../jswebcontrol` (README:17).
- **Backend internals**: Prisma schema diffs, `sharelyai-be` file paths, internal
  route names, "can't ship publicly" notes (README §5, §6, line 122).
- **Broken build/test commands** (README §8): `node packages/server/examples/
smoke.mjs` and `packages/adapter-vercel-ai/examples/conformance.mjs` — **those
  paths don't exist**; the real smokes live at `examples/*/smoke.mjs`.
- Stale protocol count: §4 says "11 in‑band events" but the protocol has 12
  (it omits `metadata_update`).

**Acceptance criteria.**

- README reads as a getting‑started for an external developer: what the SDK is,
  install, the `Handler` contract, a minimal working `createSharelyServer`
  example, env‑var reference, links to per‑package READMEs and to `examples/`.
- No references to private sibling repos or backend internals.
- All commands actually work.
- The existing handoff content is preserved at `docs/internal-handoff.md` (not
  deleted — it's useful internally).

**Claude prompt.**

```
The root README.md is an internal engineering handoff doc and is not suitable for
a public OSS release. Do two things:

1. Move the current README.md content to docs/internal-handoff.md unchanged
   (keep it for the team).
2. Write a new public-facing README.md aimed at an external developer adopting
   the SDK. Include:
   - One-paragraph "what this is": build a Sharely-compatible agent server; the
     SDK owns HTTP/auth/persistence/SSE, you bring the agent logic.
   - Install (npm install @sharelyai/server etc.).
   - The Handler contract (type Handler = (input: AgentInput) =>
     AsyncIterable<AgentEvent>) with a minimal createSharelyServer example.
   - A short env-var/config reference (apiUrl, workspaceId, workspaceApiKey,
     allowedOrigins, etc.).
   - The package table (purpose only — no LOC/phase/internal status columns).
   - Links to per-package READMEs and to the examples/ directory.
   - CI badge (after CI lands), License section.
   REMOVE everything that references private repos (../sharelyai-be, etc.),
   backend Prisma/route internals, "can't ship publicly" notes, and phase/handoff
   framing. FIX the build/test commands to point at the real example smoke paths
   (examples/<name>/smoke.mjs). Correct the protocol event count (it's 12 in-band
   including metadata_update).

Show me the new README before writing it.
```

---

### Combined quick‑win prompt (P0‑1 + P0‑4‑bug + P0‑5 + P0‑6 + P2‑1)

```
Do the following low-risk OSS-prep tasks in one pass, showing me the full diff at
the end:
1. Add the license: a root LICENSE file with the full Apache-2.0 text, a root
   NOTICE file (Copyright 2026 Sharely.ai Inc.), and change every package.json
   "license" field from "MIT" to "Apache-2.0" (root + packages/* + apps/*).
2. Scrub internal URLs: replace the *.azurefd.net SHARELY_API_URL in all
   apps/*/.env.example with https://api.sharely.ai, and the
   https://sharely-develop.fly.dev comment in
   examples/anthropic-sdk-direct/server.ts likewise. Grep to confirm none remain.
3. In packages/conformance/src/validate.ts add 'metadata_update' to KNOWN_TYPES.
4. Clean up the root package.json: set a real description, author, remove the
   bogus "main": "index.js" (there's no such file), keep private:true.
5. Vendor @sharelyai/tsconfig into packages/tsconfig and repoint all
   packages/*/tsconfig.json at it (workspace protocol), removing the external
   devDependency. Run `npx turbo run build` to confirm green.
Do NOT change strict mode or rewrite the README in this pass — those are separate.
```

---

# 🟠 P1 — High

## P1‑1 — Replace `"*"` inter‑package dependencies with real ranges (DO NOT DO THIS ONE)

**Why it matters.** Confirmed live on npm: `@sharelyai/server@0.0.5` depends on
`"@sharelyai/api": "*"` and `"@sharelyai/protocol": "*"`. A consumer installing
`@sharelyai/server` today resolves `api`/`protocol` to _whatever is latest_ — a
future breaking `protocol` publish silently breaks existing installs with no
semver signal. Fine inside a workspace; wrong for published packages.

**Acceptance criteria.** Inter‑package deps use caret/pinned ranges
(`^x.y.z`) that match the versions being published together. Local development
still resolves to the workspace copies.

**Claude prompt.**

```
Our published packages depend on each other with "*" version ranges (e.g.
@sharelyai/server depends on "@sharelyai/api": "*"). This is unsafe for published
npm packages. Change all inter-@sharelyai/* dependencies in packages/*/package.json
from "*" to caret ranges pinned to the current version of the target package
(e.g. "^0.0.4" for @sharelyai/api). Make sure local workspace resolution still
works (npm workspaces resolves by name regardless of range). Confirm
`npm install` and `npx turbo run build` still pass. Note: this needs a
coordinated version bump + republish — list which packages need a new version as
a result.
```

---

## P1‑2 — Handle expired platform JWTs

**Why it matters.** `packages/server/src/createServer.ts:89-131`: the exchanged
access JWT is cached **forever** per role in `platformAuthByRole`, cleared only
if the _exchange itself_ throws (`:125`). If a cached JWT expires mid‑life, every
downstream Backplane call 401s until the process restarts — the code never
invalidates on a downstream 401. Latent outage for any long‑running server.

**Acceptance criteria.** Cached JWTs are invalidated and re‑exchanged on expiry
(decode `exp` and refresh proactively, or catch 401 from `api.*` calls and retry
once after a forced re‑exchange). A test simulates an expired token and asserts
recovery without restart.

**Claude prompt.**

```
In packages/server/src/createServer.ts, the platformAuthByRole map caches the
exchanged access JWT forever and only clears it when the exchange call itself
throws. If the cached JWT expires while the process runs, all downstream
Backplane calls will 401 until restart.

Fix this. Preferred approach: decode the JWT exp claim at exchange time, store it
with the cached promise, and treat the entry as stale shortly before exp so the
next request re-exchanges. Also add a fallback: if a Backplane call via the api
client returns 401/403, invalidate the cached role entry and retry the exchange
once. Keep the per-role caching. Add a unit test that simulates an expired token
and asserts the server recovers without a restart. Show me the approach first.
```

---

## P1‑3 — Make the CORS default safe

**Why it matters.** `createServer.ts:137-139` passes `origin: opts.allowedOrigins`
straight to `cors()`. `allowedOrigins` is optional (`:32`); when a customer omits
it, the `cors` package **reflects any request origin**, and with `credentials:
true` (`:140`) that's "allow all origins with credentials."

**Acceptance criteria.** Omitting `allowedOrigins` does not silently allow all
origins with credentials. Either require it, default to a safe value, or emit a
loud startup warning and disable credentialed wildcard.

**Claude prompt.**

```
In packages/server/src/createServer.ts the CORS config passes opts.allowedOrigins
directly to cors() with credentials:true. When allowedOrigins is undefined, this
reflects any origin and allows credentials — unsafe.

Change the behavior so that when allowedOrigins is not provided, we do NOT allow
arbitrary origins with credentials. Pick the safest sensible default and log a
clear warning at startup telling the developer to set allowedOrigins for
production. Keep the explicit-allowlist path working when it IS provided. Add a
test covering both cases.
```

---

## P1‑4 — Stop leaking internal error messages to clients

**Why it matters.** On handler crash the server returns `err.message` to the
caller (`createServer.ts:353`, also `pipeline.ts:172`). Upstream/Backplane error
text can carry internal detail.

**Acceptance criteria.** Client‑facing 500 responses use a generic message; the
real error is logged server‑side. The SSE `error` event likewise doesn't forward
raw upstream messages.

**Claude prompt.**

```
The server returns raw err.message to clients on failures
(packages/server/src/createServer.ts ~line 353, and the SSE error event in
packages/server/src/pipeline.ts ~line 172). This can leak internal/upstream
detail.

Change client-facing 500 responses and the SSE error event to a generic message
(e.g. "An internal error occurred") while logging the full error server-side via
logger.error. Keep validation (4xx) messages — those are intentional and safe.
Add a test asserting a thrown handler error does not surface its message to the
client.
```

---

## P1‑5 — Document (and ideally constrain) the catch‑all reverse proxy

**Why it matters.** `createServer.ts:387` `app.all('*')` forwards **any
method/path** to the Sharely backend, passing the caller's headers through
(including `Authorization` — the fetcher keeps it), with no route allowlist and
no token validation on this path (validation only guards `/chat`). It relies
entirely on the backend to authorize. Customers will come to depend on
undocumented passthrough routes you can never remove.

**Acceptance criteria.** The proxy behavior is documented as an explicit security
boundary in the server package README. Ideally the proxied routes are
allowlisted (or the catch‑all is opt‑in via a config flag).

**Claude prompt.**

```
packages/server/src/createServer.ts has a catch-all `app.all('*')` that proxies
any method/path to the Sharely backend with the caller's Authorization header and
no allowlist. Two things:
1. Document this clearly in packages/server/README.md as a security boundary:
   what it forwards, that auth is delegated to the backend, and that it's a
   pass-through.
2. Propose (and implement if straightforward) an allowlist or an opt-in config
   flag (e.g. enableProxy or proxyAllowlist) so customers don't unknowingly
   depend on undocumented routes. Default to the current behavior only if you
   document it loudly; otherwise default to safer. Show me the design first.
```

---

## P1‑6 — Versioning discipline (Changesets + a real 1.0 line)

**Why it matters.** Packages are at `0.0.x`, bumped manually, no changelog, no
git tags, `"*"` cross‑deps (P1‑1). For a GA SDK consumers need semver signals and
a changelog.

**Acceptance criteria.** Changesets (or equivalent) wired; `CHANGELOG.md` per
package generated on release; a deliberate version line chosen for GA (e.g.
graduate to `0.1.0`/`1.0.0`); release process documented in `CONTRIBUTING.md`.

**Claude prompt.**

```
Set up versioning + changelog discipline for this npm/Turborepo monorepo using
@changesets/cli:
- Install and init changesets, configured for our public @sharelyai/* packages
  (and excluding private apps/*).
- Add the changeset + version + publish scripts to the root package.json.
- Document the release flow (add changeset -> version -> publish) in a new
  CONTRIBUTING.md section.
- Recommend a GA version line for the packages (we're at 0.0.x alpha; propose
  whether to go 0.1.0 or 1.0.0 and why) but DON'T bump versions until I confirm.
Show me the config and the proposed version plan.
```

---

# 🟡 P2 — Polish

## P2‑1 — Clean up the root `package.json`

`"name": "sharelyai"`, `"version": "0.0.1"`, `"description": ""`,
`"author": ""`, `"main": "index.js"` (no such file). It's `private: true` so it
won't publish, but it's the repo's front door. _(Folded into the combined
quick‑win prompt above.)_

## P2‑2 — Declare `engines.node`

No package declares a Node floor, yet the code uses `globalThis.crypto.randomUUID`
and `AbortSignal.any` (`packages/server/src/fetcher.ts:65`) — Node 18.17+/20+.

**Claude prompt.**

```
Add an "engines": { "node": ">=20" } field (confirm the floor — we use
AbortSignal.any and crypto.randomUUID, so 18.17+ minimum; recommend >=20) to each
published package's package.json and the root. Make CI's Node version match.
```

## P2‑3 — npm metadata for discoverability

Published packages lack `repository.directory`, `keywords`, and `homepage`.

**Claude prompt.**

```
Improve npm metadata on each published packages/*/package.json: add
"repository" with the correct "directory" (e.g. "packages/server"), a "homepage",
and relevant "keywords" (sharely, agent, sse, ai, etc.). Use the repo URL from
the root package.json.
```

## P2‑4 — Make the logger pluggable / structured

`packages/server/src/logger.ts` is a `console` wrapper gated on `DEBUG=true` — no
levels, not injectable. `TraceSpan` (`packages/server/src/context.ts:6-19`) is a
no‑op console logger implying observability that isn't there.

**Claude prompt.**

```
The server's logger (packages/server/src/logger.ts) is a console wrapper with no
levels and no way for customers to inject their own. Add an optional `logger`
option to CreateSharelyServerOptions that accepts a minimal Logger interface
(debug/info/warn/error), defaulting to the current console one. Thread it through
createServer/pipeline/context/fetcher instead of the module-level singleton. Also
add a short note in the server README that TraceSpan is currently a stub (no real
OpenTelemetry wiring). Keep changes backward-compatible.
```

## P2‑5 — Graceful shutdown in the live demos

No SIGTERM handling / connection draining in the runtime or `apps/live-demo-*`.

**Claude prompt.**

```
Add graceful shutdown to the apps/live-demo-* servers: handle SIGTERM/SIGINT,
stop accepting new connections, let in-flight SSE streams finish (with a
timeout), then exit. If it's reasonable to expose a helper from @sharelyai/server
to make this easy for customers, propose it.
```

## P2‑6 — Confirm `apps/*` can't be published; plan the Express 5 bump

- Verify each `apps/live-demo-*/package.json` has `private: true` so demos can't
  be accidentally `npm publish`ed.
- `@sharelyai/server` pins Express `^4.21.1`; Express 5 is stable in 2026 — plan
  the upgrade (not urgent).

**Claude prompt.**

```
Two small things:
1. Verify every apps/live-demo-*/package.json has "private": true (add it if
   missing) so the demo apps can never be published to npm.
2. Assess upgrading @sharelyai/server from Express 4 to Express 5: list the
   breaking changes that affect our usage (routing, app.all('*'), middleware
   signatures) and what it would take. Don't do the upgrade yet — just report.
```

---

## Appendix — finding → task index

| #        | Finding                                   | File(s)                                                            |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ |
| P0‑1     | External unlicensed tsconfig dependency   | `packages/*/tsconfig.json`                                         |
| P0‑2     | `strict: false`                           | shared base tsconfig                                               |
| P0‑3     | Zero tests                                | `turbo.json`, all packages                                         |
| P0‑4     | No CI                                     | (new) `.github/workflows/ci.yml`                                   |
| P0‑4‑bug | `metadata_update` rejected by validator   | `packages/conformance/src/validate.ts:8`                           |
| P0‑5     | Leaked internal URLs                      | `apps/*/.env.example`, `examples/anthropic-sdk-direct/server.ts:7` |
| P0‑6     | No LICENSE file                           | repo root                                                          |
| P0‑7     | README is internal handoff doc            | `README.md`                                                        |
| P1‑1     | `"*"` inter‑package deps                  | `packages/*/package.json`                                          |
| P1‑2     | No JWT expiry handling                    | `packages/server/src/createServer.ts:89-131`                       |
| P1‑3     | Unsafe CORS default                       | `packages/server/src/createServer.ts:137-140`                      |
| P1‑4     | Internal error messages leak to clients   | `createServer.ts:353`, `pipeline.ts:172`                           |
| P1‑5     | Open reverse‑proxy catch‑all              | `packages/server/src/createServer.ts:387`                          |
| P1‑6     | No versioning/changelog discipline        | repo‑wide                                                          |
| P2‑1     | Sloppy root manifest                      | `package.json`                                                     |
| P2‑2     | No `engines.node`                         | `packages/*/package.json`                                          |
| P2‑3     | Thin npm metadata                         | `packages/*/package.json`                                          |
| P2‑4     | Logger not pluggable; TraceSpan is a stub | `packages/server/src/logger.ts`, `context.ts`                      |
| P2‑5     | No graceful shutdown                      | `apps/live-demo-*`                                                 |
| P2‑6     | Verify apps private; Express 5            | `apps/*/package.json`, `packages/server`                           |

---

_Generated from a first‑hand code audit, June 2026. Prompts are starting points —
review Claude's plan before approving edits._
