# Adapter-backed — Temporal

Run your agent inside a Temporal workflow. [`@sharelyai/adapter-temporal`](../../packages/adapter-temporal/) starts the workflow per chat turn and polls its event-buffer query until `message_end`. The workflow side emits `AgentEvent`s via `createAgentEventSink` + `emitAgentEvent`.

Use this when you want **durable, retryable, observable** agent runs — long-running tool calls, queue-backed execution, replayable history, full Temporal observability.

## Files

| File                         | Purpose                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handler.ts`](./handler.ts) | `createTemporalHandler({ client })` — thin wrapper over `fromTemporal`. Also exports `wrapTemporalClient` to adapt a real `@temporalio/client` `Client` to the structural shape the adapter consumes. |
| [`server.ts`](./server.ts)   | Sets up the Temporal `Connection` + `Client` and wires the handler into `createSharelyServer`.                                                                                                        |
| [`smoke.mjs`](./smoke.mjs)   | Runnable proof. Fakes the Temporal client with an in-process sink; drives the full polling / cursor / abort path. No Temporal server needed.                                                          |

The **workflow side** lives in your worker codebase (snippet below) — it's not a file in this example because it needs `@temporalio/workflow` to type-check and you'll customize it heavily for your agent logic.

## Run the smoke

```bash
npm install
npx turbo run build
node examples/adapter-temporal/smoke.mjs
```

Expected: `all checks passed`.

## The two sides

### 1. Client side — what `handler.ts` does

```ts
import { fromTemporal } from '@sharelyai/adapter-temporal';

export const createTemporalHandler = ({ client }) =>
  fromTemporal({
    client, // a TemporalClientLike
    workflowType: 'sharelyAgentWorkflow', // registered name on your worker
    taskQueue: 'sharely-agents', // your worker's queue
    pollIntervalMs: 200,
  });
```

`fromTemporal` returns a `Handler`. On each chat turn it `client.start()`s a workflow execution and polls the `AGENT_EVENTS_QUERY` query, yielding `AgentEvent`s as they arrive. Client disconnect (`input.signal`) calls `handle.cancel()` on the workflow.

### 2. Worker side — your workflow

This goes in your **worker codebase** (a separate Node process). The workflow uses `createAgentEventSink` + `emitAgentEvent` to expose its events to the polling client.

```ts
// workflow.ts
import { defineQuery, setHandler } from '@temporalio/workflow';
import {
  AGENT_EVENTS_QUERY,
  createAgentEventSink,
  emitAgentEvent,
} from '@sharelyai/adapter-temporal';
import type { AgentEvent } from '@sharelyai/protocol';

interface WorkflowInput {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string | null }>;
  context: {
    workspaceId: string;
    threadId: string;
    spaceId?: string;
    userId?: string;
    temporalUserId?: string;
    roleId?: string | null;
    languageId?: string;
    topK?: number;
  };
}

export const sharelyAgentWorkflow = async (
  input: WorkflowInput,
): Promise<void> => {
  const sink = createAgentEventSink();
  setHandler(
    defineQuery<
      { events: AgentEvent[]; done: boolean; cursor?: number },
      [number]
    >(AGENT_EVENTS_QUERY),
    sink.query,
  );

  emitAgentEvent(sink, {
    type: 'message_start',
    role: 'assistant',
    model: 'my-model',
  });

  // ... your real workflow logic here: model calls via activities, tool
  // calls, etc. Call emitAgentEvent for each AgentEvent as it happens.
  emitAgentEvent(sink, {
    type: 'content_delta',
    delta: `Echo: ${input.message}`,
  });

  // Optional: after a tool activity completes, surface its sources and any
  // per-tool extras you want to keep on the assistant message. The pipeline
  // appends `sources` events and shallow-merges `metadata_update` events
  // into the persisted assistant row.
  // emitAgentEvent(sink, {
  //   type: 'sources',
  //   sources: toolResult.sources,
  // });
  // emitAgentEvent(sink, {
  //   type: 'metadata_update',
  //   metadata: { [toolName]: toolResult.output },
  // });

  emitAgentEvent(sink, { type: 'content_end' });
  emitAgentEvent(sink, {
    type: 'message_end',
    finishReason: 'stop',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
};
```

Register and run it with `@temporalio/worker`:

```ts
// worker.ts
import { Worker } from '@temporalio/worker';

await Worker.create({
  workflowsPath: require.resolve('./workflow'),
  taskQueue: 'sharely-agents',
}).then(w => w.run());
```

## Cancellation

Client disconnect → `input.signal.aborted` → adapter calls `handle.cancel()` on the workflow handle. Temporal then cancels the workflow execution; your `await Activity.execute(...)` calls throw `CancelledFailure` and you can clean up. The smoke verifies this end-to-end.

## Why `wrapTemporalClient`?

The adapter's `TemporalClientLike` shape is `{ start(workflowType, options) }` — flat. Real `@temporalio/client` exposes `client.workflow.start(...)` (nested). `wrapTemporalClient` is one line that adapts one to the other so the handler file stays free of `@temporalio/client` types.

## Persistence

Sharely's server persists message history in `agentMessage`; the workflow doesn't need to. The workflow receives the prior turns via `input.history` and emits its events; `@sharelyai/server` handles the rest.
