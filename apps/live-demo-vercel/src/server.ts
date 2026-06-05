import 'dotenv/config';
import { createSharelyServer, installGracefulShutdown } from '@sharelyai/server';
import { handler } from './handler.js';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const app = createSharelyServer({
  apiUrl: required('SHARELY_API_URL'),
  workspaceId: required('SHARELY_WORKSPACE_ID'),
  workspaceApiKey: required('SHARELY_WORKSPACE_API_KEY'),
  handler,
});

const port = Number(process.env['PORT'] ?? 8081);
const server = app.listen(port, () =>
  console.log(`[live-demo-vercel] sharely agent server listening on :${port}`),
);
installGracefulShutdown(server);
