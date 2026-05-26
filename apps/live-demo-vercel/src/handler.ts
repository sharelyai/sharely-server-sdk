import { streamText, tool, jsonSchema, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { fromVercelAI, toCoreMessages } from '@sharelyai/adapter-vercel-ai';
import {
  semanticSearch,
  searchKnowledge,
  getKnowledgeItem,
  listTaxonomies,
  getTaxonomyKnowledge,
  getWorkspaceStats,
  listRoles,
} from '@sharelyai/adapter-vercel-ai/tools';
import type { Handler } from '@sharelyai/protocol';

const MODEL = 'gpt-5.4-mini';

// Customer-defined tool. Lives entirely in this agent server — sharelyai-be
// doesn't know it exists. Demonstrates mixing first-party Sharely tools with
// your own. Backed by wttr.in (free, no API key).
const getWeather = tool({
  description:
    'Get the current weather for a city. Use this when the user asks about weather or temperature in a specific location.',
  inputSchema: jsonSchema<{ city: string }>({
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name, e.g. "Berlin"' },
    },
    required: ['city'],
  }),
  execute: async ({ city }) => {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
    );
    if (!res.ok) {
      return { error: `weather lookup failed: ${res.status}` };
    }
    const data = (await res.json()) as {
      current_condition?: Array<{
        temp_C?: string;
        temp_F?: string;
        humidity?: string;
        weatherDesc?: Array<{ value?: string }>;
      }>;
    };
    const current = data.current_condition?.[0];
    return {
      city,
      tempC: current?.temp_C ? Number(current.temp_C) : null,
      tempF: current?.temp_F ? Number(current.temp_F) : null,
      humidity: current?.humidity ? Number(current.humidity) : null,
      condition: current?.weatherDesc?.[0]?.value ?? null,
    };
  },
});

export const handler: Handler = fromVercelAI(
  input =>
    streamText({
      model: openai(MODEL),
      system:
        'You are a helpful Sharely agent. Use the workspace tools when the user asks about knowledge, taxonomies, workspace stats, or roles. Prefer semantic_search for conceptual queries and search_knowledge for keyword lookups. Use get_weather for weather questions. After a tool returns, summarize the result for the user in natural language.',
      messages: toCoreMessages(input),
      stopWhen: stepCountIs(8),
      tools: {
        semantic_search: semanticSearch(input.context),
        search_knowledge: searchKnowledge(input.context),
        get_knowledge_item: getKnowledgeItem(input.context),
        list_taxonomies: listTaxonomies(input.context),
        get_taxonomy_knowledge: getTaxonomyKnowledge(input.context),
        get_workspace_stats: getWorkspaceStats(input.context),
        list_roles: listRoles(input.context),
        get_weather: getWeather,
      },
      abortSignal: input.signal,
    }),
  { model: MODEL },
);
