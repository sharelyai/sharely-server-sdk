// Wire the Pattern C LangGraph handler into createSharelyServer.
//
//   npm i @langchain/langgraph @langchain/anthropic @langchain/core zod \
//         @sharely/server @sharely/protocol
//
// Env vars:
//   ANTHROPIC_API_KEY         — Anthropic key (read by @langchain/anthropic)
//   SHARELY_API_URL           — sharelyai-be base URL
//   SHARELY_WORKSPACE_ID      — your workspace id
//   SHARELY_WORKSPACE_API_KEY — workspace access-key token

import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { createSharelyServer } from '@sharely/server';
import { createLangGraphHandler } from './handler.js';

const lookup = tool(
  async ({ q }: { q: string }) => ({
    answer: 42,
    query: q,
    // Sources convention: anything under `sources` gets pulled into the
    // batched `sources` event by the handler.
    sources: [
      {
        id: 'src-1',
        type: 'knowledge',
        title: 'Reference doc',
        url: 'https://example.com/doc',
      },
    ],
  }),
  {
    name: 'lookup',
    description: 'Look something up by keyword.',
    schema: z.object({ q: z.string() }),
  },
);

const graph = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-sonnet-4-6' }),
  tools: [lookup],
});

const app = createSharelyServer({
  apiUrl: process.env['SHARELY_API_URL']!,
  workspaceId: process.env['SHARELY_WORKSPACE_ID']!,
  workspaceApiKey: process.env['SHARELY_WORKSPACE_API_KEY']!,
  handler: createLangGraphHandler({
    graph,
    model: 'claude-sonnet-4-6',
  }),
});

const port = Number(process.env['PORT'] ?? 8080);
app.listen(port, () =>
  console.log(`Sharely agent server listening on :${port}`),
);
