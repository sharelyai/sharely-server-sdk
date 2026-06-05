# Express 4 → 5 upgrade assessment

> Status: **assessment only — not yet performed.** `@sharelyai/server` pins
> Express `^4.21.1`. Express 5 is stable; this documents what an upgrade would
> take. Effort estimate: **small (½ day)**, dominated by the route-pattern change.

## Breaking changes that affect our usage

### 1. Wildcard route strings — REQUIRES CHANGES (the only hard blocker)

Express 5 upgrades to `path-to-regexp@8`, which **removes the bare `'*'` string
pattern**. We use it in two places in `packages/server/src/createServer.ts`:

- `app.options('*', cors(corsOptions))`
- `app.all('*', …)` (the catch-all reverse proxy)

Under Express 5 these throw at registration. They must become a named wildcard:

```ts
// Express 4
app.all('*', handler);
// Express 5
app.all('/*splat', handler);   // or: app.all(/.*/, handler)
```

(`splat` is just the param name; the captured value is `req.params.splat`.)
No other routes in the SDK use string wildcards or optional `?`/`(...)` syntax.

### 2. Async error propagation — IMPROVEMENT, no change required

Express 5 forwards rejected promises from middleware/handlers to the error
handler automatically. Our handlers already `try/catch` internally, so this is
strictly additive safety, not a required change.

### 3. Removed APIs — not used

`res.json(status, body)`, `res.send(status, …)`, `app.del()`, `req.param(name)`
are all removed in Express 5. We use none of them — we already call
`res.status(...).json(...)`. No changes needed.

### 4. `req.query` is now a read-only getter — not affected

We never reassign `req.query`. No impact.

### 5. Node floor — already satisfied

Express 5 requires Node ≥ 18. We declare `engines.node >= 20`. Fine.

## Dependency compatibility

- `cors@^2.8.5` — works with Express 5.
- `express-rate-limit@^7` — supports Express 5.
- `@types/express` — bump to the Express 5 types (`@types/express@^5`).

## Recommended steps (when we choose to do it)

1. `npm i express@^5 @types/express@^5 -w @sharelyai/server`.
2. Replace `app.all('*', …)` → `app.all('/*splat', …)` and
   `app.options('*', …)` → `app.options('/*splat', …)`.
3. `npx turbo run build typecheck` and run the example smokes.

**Not urgent** — Express 4.21.x is still maintained. Schedule alongside a minor
release, not as a hotfix.
