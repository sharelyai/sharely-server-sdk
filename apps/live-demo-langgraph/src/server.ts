import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { createSharelyServer } from '@sharelyai/server';
import { createLangGraphHandler } from './handler.js';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-5.4-mini';

// Customer-defined tool — same one the vercel and temporal demos use, here as
// a LangChain `tool()`. LangGraph owns its execution; the handler observes the
// on_tool_start / on_tool_end events. Backed by wttr.in (free, no API key).
const getWeather = tool(
  async ({ city }: { city: string }) => {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
    );
    if (!res.ok) return { error: `weather lookup failed: ${res.status}` };
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
  {
    name: 'get_weather',
    description:
      'Get the current weather for a city. Use this when the user asks about weather or temperature in a specific location.',
    schema: z.object({
      city: z.string().describe('City name, e.g. "Berlin"'),
    }),
  },
);

const graph = createReactAgent({
  llm: new ChatOpenAI({ model: MODEL }),
  tools: [getWeather],
  prompt:
    'You are a helpful Sharely agent. Use get_weather for weather or temperature questions. After a tool returns, summarize the result for the user in natural language.',
});

const app = createSharelyServer({
  apiUrl: required('SHARELY_API_URL'),
  workspaceId: required('SHARELY_WORKSPACE_ID'),
  workspaceApiKey: required('SHARELY_WORKSPACE_API_KEY'),
  handler: createLangGraphHandler({ graph, model: MODEL }),
});

const port = Number(process.env['PORT'] ?? 8083);
app.listen(port, () =>
  console.log(`[live-demo-langgraph] sharely agent server listening on :${port}`),
);
