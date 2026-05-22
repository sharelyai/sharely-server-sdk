# @sharely/api

Typed client to the Sharely platform Backplane (`sharelyai-be`). Hand-written narrow client targeting the §5.5 agent-threads route subset — once the backend OpenAPI spec lands, this package will be regenerated against it.

## Install

```bash
npm i @sharely/api @sharely/protocol
```

## Usage

```ts
import { createSharelyAPIClient } from "@sharely/api";

const api = createSharelyAPIClient({
  baseUrl: process.env.SHARELY_API_URL!,      // e.g. https://sharely-develop.fly.dev
  workspaceId: process.env.WORKSPACE_ID!,
  authorization: req.headers.authorization!   // forwarded from the inbound request
});

// Backplane endpoints (require workspace access-key auth):
const thread = await api.threads.create({ title: "Onboarding chat" });
const list = await api.threads.list({ limit: 20 });
const detail = await api.threads.get(thread.id);
await api.threads.messages.create(thread.id, {
  role: "user", content: "Hi"
});
const matches = await api.rag({ text: "What is RBAC?", topK: 5 });
```

Inside `@sharely/server`, the chat route builds one of these per request and exposes it on `AgentContext.api` so your `Handler` can call platform endpoints itself.

## What it covers

| Endpoint | Method |
|---|---|
| `POST /v1/workspaces/:wsId/agent/threads` | `threads.create` |
| `GET /v1/workspaces/:wsId/agent/threads` | `threads.list` |
| `GET /v1/workspaces/:wsId/agent/threads/:threadId` | `threads.get` (includes messages) |
| `POST /v1/workspaces/:wsId/agent/threads/:threadId/messages` | `threads.messages.create` |
| `POST /v1/workspaces/:wsId/agent/rag` | `rag` |

All requests carry the configured `Authorization` header verbatim — the client never mints or validates tokens.

## Custom transport

For retry / timeout / tracing customization, inject your own transport:

```ts
import { createSharelyAPIClient, type Transport } from "@sharely/api";

const transport: Transport = async req => {
  // your own retrying fetch wrapper
  const res = await myFetch(req.url, { method: req.method, body: req.body });
  return { data: await res.json(), status: res.status };
};

const api = createSharelyAPIClient({ baseUrl, workspaceId, authorization, transport });
```

## Errors

Failed requests throw a `SharelyAPIError` carrying `status`, `message`, and the raw response `data`.
