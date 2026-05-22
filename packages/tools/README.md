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
- **`executeTool(name, input, ctx, executors)`** — dispatches by name.

## Why no execute layer?

The upstream `sharelyai-be` `execute` functions hit Prisma / Pinecone / OpenAI embeddings directly. Those can't ship in a public SDK without leaking the backend schema. Once `@sharely/api` exposes the corresponding HTTP endpoints, a customer-side executor pack will plug into `createTools(...)`. Until then, plug your own executors:

```ts
import { createTools } from "@sharely/tools";

const tools = createTools({
  search_knowledge: async (input, ctx) => {
    // your own retrieval, possibly via ctx.api (a SharelyAPIClient)
    return { output: { totalResults: 0, results: [] } };
  }
});
```
