# @sharely/protocol

Wire-protocol types for Sharely-compatible agent servers. **Types only — no runtime code.**

Extracted from `sharelyai-be/src/controller/agent/types.ts` and ratified as the published SDK contract. Adapters, the server runtime, and the platform client all reference this package — there is no second source of truth.

## What's in here

- **`AgentEvent`** — discriminated union of the 11 in-band events a `Handler` yields (`message_start`, `thinking_*`, `tool_call_*`, `content_delta`, `content_end`, `sources`, `message_end`, `error`). Plus `DoneEvent` and `WireEvent` for the envelope the server adds (`threadId`, `messageId`).
- **`Handler` / `AgentInput` / `AgentContext`** — the single function shape every agent must implement. Pattern C (raw `Handler`), `@sharelyai/adapter-vercel-ai`, and `@sharelyai/adapter-temporal` all produce this.
- **`Source` / `ThinkingStep` / `ToolCallRecord` / `TokenUsage`** — the domain payload types the server persists into the `agentMessage` row.
- **`Tool` / `ToolDefinition` / `ToolContext` / `ToolResult`** — the LLM-facing tool contract. `@sharelyai/tools` extends this with the 7 first-party definitions.
- **`SharelyAPIClient`** (stub) — narrow shape `AgentContext.api` satisfies. The real client lives in `@sharelyai/api`.
- **`TraceSpan`** (stub) — minimal trace shape; concrete impls live in `@sharelyai/server` and adapters.

## Install

```bash
npm i @sharely/protocol
```

## Minimal handler

```ts
import type { Handler } from '@sharelyai/protocol';

export const handler: Handler = async function* (input) {
  yield { type: 'message_start', role: 'assistant', model: 'my-model' };
  yield { type: 'content_delta', delta: `Echo: ${input.message}` };
  yield {
    type: 'message_end',
    finishReason: 'stop',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
};
```

## Wire format

Events are serialized as SSE by `@sharelyai/server` (`event: <type>\ndata: <json>\n\n`). The JSON payload of each event carries the typed fields of its variant **plus** `threadId` and `messageId` added by the server envelope.
