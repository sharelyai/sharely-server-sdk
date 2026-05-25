// Wire the Pattern C OpenAI Agents handler into createSharelyServer.
//
//   npm i @openai/agents zod @sharely/server @sharely/protocol
//
// Env vars:
//   OPENAI_API_KEY            — OpenAI key (read by @openai/agents)
//   SHARELY_API_URL           — sharelyai-be base URL
//   SHARELY_WORKSPACE_ID      — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { createSharelyServer } from '@sharelyai/server';
import { createOpenAIAgentsHandler } from './handler.js';

const lookup = tool({
  name: 'lookup',
  description: 'Look something up by keyword.',
  parameters: z.object({ q: z.string() }),
  // Return the Sharely `ToolResult`-ish shape so the handler can extract
  // sources for the final batched `sources` event.
  execute: async ({ q }) => ({
    output: { answer: 42, query: q },
    sources: [
      {
        id: 'src-1',
        type: 'knowledge' as const,
        title: 'Reference doc',
        url: 'https://example.com/doc',
      },
    ],
  }),
});

const agent = new Agent({
  name: 'Sharely agent',
  instructions: 'You are a helpful assistant. Use the lookup tool when asked.',
  model: 'gpt-4o-mini',
  tools: [lookup],
});

const app = createSharelyServer({
  apiUrl: process.env['SHARELY_API_URL']!,
  workspaceId: process.env['SHARELY_WORKSPACE_ID']!,
  workspaceApiKey: process.env['SHARELY_WORKSPACE_API_KEY']!,
  handler: createOpenAIAgentsHandler({ agent, model: 'gpt-4o-mini' }),
});

const port = Number(process.env['PORT'] ?? 8080);
app.listen(port, () =>
  console.log(`Sharely agent server listening on :${port}`),
);
