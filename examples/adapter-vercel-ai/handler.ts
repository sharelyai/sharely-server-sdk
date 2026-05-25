// Adapter-backed Pattern A — `@sharelyai/adapter-vercel-ai` turns a Vercel AI
// SDK `streamText` call into a Sharely `Handler` for you. You bring the
// model + prompt + tools; the adapter handles the AgentEvent translation.
//
// Copy into your project. You will need:
//   npm i ai @ai-sdk/gateway @sharelyai/adapter-vercel-ai \
//         @sharelyai/server @sharelyai/protocol
//
// (Swap @ai-sdk/gateway for any other provider — @ai-sdk/anthropic,
// @ai-sdk/openai, etc. The shape of streamText is identical.)

import { streamText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { fromVercelAI, toCoreMessages } from '@sharelyai/adapter-vercel-ai';
import { semanticSearch } from '@sharelyai/adapter-vercel-ai/tools';
import type { Handler } from '@sharelyai/protocol';

const MODEL = 'anthropic/claude-sonnet-4-6';

export const handler: Handler = fromVercelAI(
  input =>
    streamText({
      model: gateway(MODEL),
      system: 'You are a helpful assistant.',
      messages: toCoreMessages(input),
      // First-party Sharely tools, ready-wired in Vercel AI's tool() shape.
      // semanticSearch is backed by @sharelyai/api's rag() out of the box.
      tools: {
        semantic_search: semanticSearch(input.context),
      },
      abortSignal: input.signal,
    }),
  { model: MODEL },
);
