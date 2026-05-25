# @sharely/tools

First-party Sharely tool **definitions** — the LLM-facing contracts for the 7 platform tools (`search_knowledge`, `semantic_search`, `get_knowledge_item`, `list_taxonomies`, `get_taxonomy_knowledge`, `get_workspace_stats`, `list_roles`).

The same definition objects are consumed by `sharelyai-be`'s hosted agent runtime, so the JSON schema your LLM sees is identical whether the agent runs Sharely-hosted, Vercel AI–driven, or as a raw `Handler`.

## Install

```bash
npm i @sharely/tools @sharely/protocol
```

## What's shipped

- **`definitions`** — typed `ToolDefinition[]` for all 7 tools.
- Per-tool exports: `searchKnowledgeDefinition`, `semanticSearchDefinition`, `getKnowledgeItemDefinition`, `listTaxonomiesDefinition`, `getTaxonomyKnowledgeDefinition`, `getWorkspaceStatsDefinition`, `listRolesDefinition`.
- **`getToolDefinitions()`** / **`getDefinitionByName(name)`** — lookup helpers.
- **`createTools(executors)`** — produces a `Tool[]` for an executor registry you supply. Tools without a registered executor return `{ error: "Tool ... has no executor wired" }`.
- **`createPlatformExecutors(api)`** — platform-backed executors for the tools that have a Backplane endpoint today. Currently `semantic_search`, backed by `@sharelyai/api`'s `rag()`.
- **`executeTool(name, input, ctx, executors)`** — dispatches by name.

## The execute layer

The upstream `sharelyai-be` `execute` functions hit Prisma / Pinecone / OpenAI embeddings directly — those can't ship in a public SDK. Instead:

- **`semantic_search` works out of the box** — `createPlatformExecutors(api)` backs it with `@sharelyai/api`'s `rag()` (embedding + vector retrieval).
- **The other 6 tools** (`search_knowledge`, `get_knowledge_item`, `list_taxonomies`, `get_taxonomy_knowledge`, `get_workspace_stats`, `list_roles`) have no Backplane endpoint yet — plug your own executor. `search_knowledge` in particular is keyword/ILIKE search and is _not_ backed by `rag()` (that would silently turn a keyword tool into semantic search).

```ts
import { createTools, createPlatformExecutors } from '@sharelyai/tools';

const tools = createTools({
  ...createPlatformExecutors(api), // semantic_search, ready to use
  search_knowledge: async (input, ctx) => {
    // bring your own
    return { output: { totalResults: 0, results: [] } };
  },
});
```
