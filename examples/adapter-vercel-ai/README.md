# Adapter-backed — Vercel AI SDK

Drive an agent with [`ai`](https://sdk.vercel.ai/)'s `streamText`. [`@sharely/adapter-vercel-ai`](../../packages/adapter-vercel-ai/) translates the resulting `fullStream` into Sharely `AgentEvent`s for you — no protocol mapping in your code.

## Files

| File | Purpose |
|---|---|
| [`handler.ts`](./handler.ts) | The whole agent — ~15 lines. `fromVercelAI(input => streamText({...}))`. |
| [`server.ts`](./server.ts) | Wires the handler into `createSharelyServer`. |
| [`smoke.mjs`](./smoke.mjs) | Runnable proof: feeds a fake `fullStream` into `fromVercelAI` and asserts the emitted `AgentEvent` sequence. |

## Run the smoke

```bash
npm install
npx turbo run build
node examples/adapter-vercel-ai/smoke.mjs
```

Expected: `all checks passed`.

## When to use this pattern

This is the **default** for new customers. The adapter owns the wire protocol translation, the abort bridge, the source-event batching, and the token-usage forwarding. You own the model, prompt, history, and tools — that's it.

Reach for [Pattern C](../anthropic-sdk-direct/) instead when you need direct control over the loop (custom retry, prompt caching tuned to your prompt shape, custom stop conditions) or you're already on a different SDK.

## What this example shows

- `streamText({ model, system, messages: toCoreMessages(input), tools, abortSignal: input.signal })` — the full Vercel SDK shape with the conversion helpers the adapter ships.
- `toCoreMessages(input)` flattens the Sharely `AgentInput`'s `history` + current `message` into the `messages` array `streamText` expects.
- `semantic_search` is wired in from [`@sharely/adapter-vercel-ai/tools`](../../packages/adapter-vercel-ai/src/tools.ts) — the first-party Sharely tools wrapped as Vercel `tool()`s. `semanticSearch(input.context)` is backed by `@sharely/api`'s `rag()` out of the box; the other 6 tools need executors you provide.
- `abortSignal: input.signal` — client disconnect flows through to the model's HTTP stream.

## Swap the provider

The example uses `@ai-sdk/gateway` because it's vendor-neutral (the gateway routes to whichever upstream you've configured). Swap it for any other Vercel AI provider:

```ts
// import { anthropic } from '@ai-sdk/anthropic';
// model: anthropic('claude-sonnet-4-6'),

// import { openai } from '@ai-sdk/openai';
// model: openai('gpt-4o'),
```

`streamText`'s shape is identical; the adapter doesn't care which provider you picked.

## Adding more tools

```ts
import {
  semanticSearch,
  searchKnowledge,
  getKnowledgeItem,
  listTaxonomies,
  getTaxonomyKnowledge,
  getWorkspaceStats,
  listRoles,
} from '@sharely/adapter-vercel-ai/tools';

tools: {
  semantic_search: semanticSearch(input.context),
  // The others have no platform executor yet — pass yours as the 2nd arg:
  search_knowledge: searchKnowledge(input.context, async (args, ctx) => {
    return { output: await myDb.search(args.query), sources: [] };
  }),
},
```

Or bring your own Vercel `tool()`s alongside Sharely tools — `streamText` doesn't care where they came from.
