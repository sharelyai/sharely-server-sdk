// Wire the Temporal-backed handler into createSharelyServer.
//
// Env vars:
//   TEMPORAL_ADDRESS          — e.g. localhost:7233
//   TEMPORAL_NAMESPACE        — e.g. default
//   SHARELY_API_URL           — sharelyai-be base URL
//   SHARELY_WORKSPACE_ID      — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token
//
// The worker (a separate process polling the same taskQueue) is set up
// independently — see the README for that snippet.

import { Connection, Client } from '@temporalio/client';
import { createSharelyServer } from '@sharely/server';
import { createTemporalHandler, wrapTemporalClient } from './handler.js';

const main = async () => {
  const connection = await Connection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });
  const temporalClient = new Client({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
  });

  const app = createSharelyServer({
    apiUrl: process.env['SHARELY_API_URL']!,
    workspaceId: process.env['SHARELY_WORKSPACE_ID']!,
    workspaceApiKey: process.env['SHARELY_WORKSPACE_API_KEY']!,
    handler: createTemporalHandler({
      client: wrapTemporalClient(temporalClient),
      workflowType: 'sharelyAgentWorkflow',
      taskQueue: 'sharely-agents',
    }),
  });

  const port = Number(process.env['PORT'] ?? 8080);
  app.listen(port, () =>
    console.log(`Sharely agent server listening on :${port}`),
  );
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
