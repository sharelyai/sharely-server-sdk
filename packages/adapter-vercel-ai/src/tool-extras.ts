import type { AgentContext, Source } from '@sharelyai/protocol';

interface Extras {
  sources: Source[];
  metadata: Record<string, unknown>;
}

// Side channel between a Sharely-tool wrapper's `execute` (which can only
// return a value to the model) and the adapter's stream translator (which
// owns the AgentEvent output). Keyed by the request-scoped AgentContext so
// concurrent chats don't leak into each other. Cleared by `drainExtras` after
// every `tool-result` part the translator sees.
const store = new WeakMap<AgentContext, Extras>();

const init = (ctx: AgentContext): Extras => {
  let e = store.get(ctx);
  if (!e) {
    e = { sources: [], metadata: {} };
    store.set(ctx, e);
  }
  return e;
};

export const pushToolExtras = (
  ctx: AgentContext,
  toolName: string,
  result: { sources?: Source[]; output?: unknown },
): void => {
  const slot = init(ctx);
  if (result.sources?.length) slot.sources.push(...result.sources);
  if (result.output && typeof result.output === 'object') {
    slot.metadata[toolName] = result.output;
  }
};

export const drainToolExtras = (ctx: AgentContext): Extras => {
  const slot = store.get(ctx);
  if (!slot) return { sources: [], metadata: {} };
  const drained: Extras = {
    sources: slot.sources.slice(),
    metadata: { ...slot.metadata },
  };
  slot.sources = [];
  slot.metadata = {};
  return drained;
};
