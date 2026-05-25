// Wire the Vercel AI–backed handler into createSharelyServer.
//
// Env vars:
//   AI_GATEWAY_API_KEY        — Vercel AI Gateway key (read by @ai-sdk/gateway)
//                               OR provider-specific keys if you swap the provider
//   SHARELY_API_URL           — sharelyai-be base URL
//   SHARELY_WORKSPACE_ID      — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token

import { createSharelyServer } from '@sharely/server';
import { handler } from './handler.js';

const app = createSharelyServer({
  apiUrl: process.env['SHARELY_API_URL']!,
  workspaceId: process.env['SHARELY_WORKSPACE_ID']!,
  workspaceApiKey: process.env['SHARELY_WORKSPACE_API_KEY']!,
  handler,
});

const port = Number(process.env['PORT'] ?? 8080);
app.listen(port, () =>
  console.log(`Sharely agent server listening on :${port}`),
);
