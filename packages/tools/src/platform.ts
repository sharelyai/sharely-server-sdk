import type { Source } from "@sharely/protocol";
import type { SharelyAPIClient } from "@sharely/api";
import type { ExecutorRegistry } from "./index.js";

interface RagMatchLike {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

const ragMatchToSource = (m: RagMatchLike): Source => {
  const meta = m.metadata ?? {};
  const title =
    typeof meta["title"] === "string"
      ? (meta["title"] as string)
      : typeof meta["source"] === "string"
        ? (meta["source"] as string)
        : "Result";
  const url =
    typeof meta["url"] === "string"
      ? (meta["url"] as string)
      : typeof meta["sourceUrl"] === "string"
        ? (meta["sourceUrl"] as string)
        : undefined;
  return {
    id: m.id,
    type: "semantic",
    title,
    ...(url ? { url } : {}),
    metadata: { score: m.score, ...meta }
  };
};

/**
 * Platform-backed executors for the Sharely tools that have a Backplane
 * endpoint **today**. Pass the result to `createTools(...)`.
 *
 * Shipped: `semantic_search` — backed by `@sharely/api`'s `rag()` (embedding +
 * vector retrieval against the workspace knowledge base).
 *
 * NOT shipped, intentionally: `search_knowledge` (keyword/ILIKE search) and the
 * taxonomy / workspace-stats / roles tools — they require Backplane endpoints
 * that do not exist yet. Backing `search_knowledge` with `rag()` would make a
 * keyword tool silently do semantic search, misleading the model. Wire those
 * yourself via `createTools({ search_knowledge: yourExecutor, ... })`.
 */
export const createPlatformExecutors = (
  api: SharelyAPIClient
): ExecutorRegistry => ({
  semantic_search: async input => {
    const text = typeof input["text"] === "string" ? input["text"].trim() : "";
    if (!text) return { error: "semantic_search requires a non-empty 'text'" };

    const topK = typeof input["topK"] === "number" ? input["topK"] : undefined;
    const languageId =
      typeof input["languageId"] === "string"
        ? (input["languageId"] as string)
        : undefined;

    const matches = await api.rag({
      text,
      ...(topK !== undefined ? { topK } : {}),
      ...(languageId !== undefined ? { languageId } : {})
    });

    return {
      output: {
        totalResults: matches.length,
        results: matches.map(m => ({
          id: m.id,
          score: m.score,
          ...(m.metadata ?? {})
        }))
      },
      sources: matches.map(ragMatchToSource)
    };
  }
});
