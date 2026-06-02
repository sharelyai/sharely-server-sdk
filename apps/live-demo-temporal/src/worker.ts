import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.js';

const main = async (): Promise<void> => {
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });

  // Resolve the workflow module next to this file — `.ts` under tsx (dev),
  // `.js` under node (after build). The worker bundles it for the sandbox.
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const workflowsPath = fileURLToPath(new URL(`./workflow${ext}`, import.meta.url));

  const taskQueue = process.env['TEMPORAL_TASK_QUEUE'] ?? 'sharely-agents';
  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    taskQueue,
    workflowsPath,
    activities,
  });

  console.log(`[live-demo-temporal] worker polling task queue "${taskQueue}"`);
  await worker.run();
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
