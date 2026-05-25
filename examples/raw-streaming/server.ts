// Wire the raw Pattern C handler into createSharelyServer.
//
//   npm i @sharely/server @sharely/protocol
//
// Env vars:
//   SHARELY_API_URL           — sharelyai-be base URL
//   SHARELY_WORKSPACE_ID      — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token

import { createSharelyServer } from '@sharelyai/server';
import { rawHandler } from './handler.js';

const app = createSharelyServer({
  apiUrl: process.env['SHARELY_API_URL']!,
  workspaceId: process.env['SHARELY_WORKSPACE_ID']!,
  workspaceApiKey: process.env['SHARELY_WORKSPACE_API_KEY']!,
  handler: rawHandler,
});

const port = Number(process.env['PORT'] ?? 8080);
app.listen(port, () =>
  console.log(`Sharely agent server listening on :${port}`),
);
