# Contributing

Thanks for contributing to the Sharely Server SDK.

## Development

```bash
npm install            # install all workspaces
npx turbo run build    # build every package
npx turbo run typecheck
```

This is an npm + Turborepo monorepo:

- `packages/*` — the published `@sharelyai/*` packages.
- `apps/*` — private live-demo servers (never published; `private: true`).

All packages share the TypeScript base config in `@sharelyai/tsconfig`
(`base.json`). Each package's `tsconfig.json` extends it.

## Releasing (manual)

Releases are published to npm **manually**. Versions are bumped by hand in each
package's `package.json` (no automated version tooling).

Publish in **dependency order** so consumers never resolve a package whose
upstream isn't on npm yet:

1. `@sharelyai/protocol`
2. `@sharelyai/api`
3. `@sharelyai/tools`
4. `@sharelyai/conformance`
5. `@sharelyai/server`
6. `@sharelyai/adapter-vercel-ai`
7. `@sharelyai/adapter-temporal`

For each package that changed:

```bash
npx turbo run build                 # ensure dist/ is current
cd packages/<name>
# bump "version" in package.json (and any inter-@sharelyai/* dep ranges)
npm publish                         # publishConfig.access is "public"
```

> Inter-package dependencies are currently declared as `"*"`. When you bump a
> package that others depend on, update those ranges in the same release so a
> published consumer resolves a compatible version.

### Versioning

Packages are on the `0.0.x` alpha line. **Recommendation for the first GA-quality
release:** graduate to **`0.1.0`** rather than `1.0.0`.

- Staying in `0.x` keeps SemVer's "anything may change" latitude while the public
  API settles, which is appropriate this early.
- `0.1.0` is still a clear, deliberate signal that the SDK has left `0.0.x`
  throwaway-alpha territory.
- Reserve `1.0.0` for when the `Handler`/event-protocol contract and the
  `createSharelyServer` options are committed to as stable.

Bump all published packages together to the same line so versions stay legible.

## Tests

The SDK uses [Vitest](https://vitest.dev). Run the whole suite from the repo
root:

```bash
npx turbo run test     # or: npm test
```

Per-package tests live in `packages/<name>/test/`; run one package's tests in
watch mode with `npm run test:watch -w @sharelyai/<name>`. For an end-to-end
sanity check you can still run the example smoke scripts in
`examples/<name>/smoke.mjs`.
