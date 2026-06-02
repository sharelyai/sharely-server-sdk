import 'dotenv/config';
import { Connection, Client } from '@temporalio/client';
import { createSharelyServer } from '@sharelyai/server';
import { createTemporalHandler, wrapTemporalClient } from './handler.js';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const main = async (): Promise<void> => {
  // Connect to the Temporal frontend. The worker (a separate process — see
  // worker.ts) polls the same task queue and runs the workflow.
  const connection = await Connection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });
  const temporalClient = new Client({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
  });

  const app = createSharelyServer({
    apiUrl: required('SHARELY_API_URL'),
    workspaceId: required('SHARELY_WORKSPACE_ID'),
    workspaceApiKey: required('SHARELY_WORKSPACE_API_KEY'),
    handler: createTemporalHandler({
      client: wrapTemporalClient(temporalClient),
      workflowType: 'sharelyAgentWorkflow',
      taskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'sharely-agents',
    }),
  });

  const port = Number(process.env['PORT'] ?? 8082);
  app.listen(port, () =>
    console.log(`[live-demo-temporal] sharely agent server listening on :${port}`),
  );
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
