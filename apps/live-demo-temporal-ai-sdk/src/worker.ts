import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { Worker, NativeConnection } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import { openai } from '@ai-sdk/openai';
import * as activities from './activities.js';

const main = async (): Promise<void> => {
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });

  // Resolve the workflow module next to this file — `.ts` under tsx (dev),
  // `.js` under node (after build). The worker bundles it for the sandbox.
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const workflowsPath = fileURLToPath(new URL(`./workflow${ext}`, import.meta.url));

  const taskQueue = process.env['TEMPORAL_TASK_QUEUE'] ?? 'sharely-agents-ai-sdk';
  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
    taskQueue,
    workflowsPath,
    activities,
    // The AI SDK plugin wires `temporalProvider.languageModel(...)` calls made
    // inside the workflow to durable activities, using this model provider. The
    // OpenAI provider reads OPENAI_API_KEY from the worker's environment.
    plugins: [new AiSdkPlugin({ modelProvider: openai })],
  });

  console.log(
    `[live-demo-temporal-ai-sdk] worker polling task queue "${taskQueue}"`,
  );
  await worker.run();
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
