// Wire the Pattern C Anthropic handler into createSharelyServer.
//
//   npm i @anthropic-ai/sdk @sharely/server @sharely/protocol
//
// Then `tsx server.ts` (or compile first) with these env vars set:
//   ANTHROPIC_API_KEY        — Anthropic API key
//   SHARELY_API_URL          — sharelyai-be base URL (e.g. https://sharely-develop.fly.dev)
//   SHARELY_WORKSPACE_ID     — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token (validates incoming user tokens)

import Anthropic from "@anthropic-ai/sdk";
import { createSharelyServer } from "@sharely/server";
import { createAnthropicHandler } from "./handler.js";

const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"]! });

const app = createSharelyServer({
  apiUrl: process.env["SHARELY_API_URL"]!,
  workspaceId: process.env["SHARELY_WORKSPACE_ID"]!,
  workspaceApiKey: process.env["SHARELY_WORKSPACE_API_KEY"]!,
  handler: createAnthropicHandler({
    client,
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a helpful assistant.",
    tools: [
      // Bring your own tool executors. See `@sharely/tools` for the 7
      // first-party Sharely tool definitions; `createPlatformExecutors(api)`
      // ships a platform-backed `semantic_search` you can wrap here.
    ]
  })
});

const port = Number(process.env["PORT"] ?? 8080);
app.listen(port, () => console.log(`Sharely agent server listening on :${port}`));
