// Activities run in the worker's Node process (NOT the deterministic workflow
// sandbox), so I/O — fetch, env vars, timers — is allowed here.
//
// Unlike the sibling `live-demo-temporal`, this variant does NOT run the LLM
// loop in an activity. The Temporal AI SDK plugin (see worker.ts) injects its
// own activities for every `temporalProvider.languageModel(...)` call, so the
// model turns are already durable. The only activity *we* hand-write is the
// customer tool — `get_weather` — which the workflow exposes to the model via
// `proxyActivities` + the AI SDK's `tool()` helper. Each tool call then runs as
// its own retryable Temporal activity.

import type { AgentMessage } from '@sharelyai/protocol';

/** Serializable subset of AgentContext handed to the workflow by the adapter. */
export interface WorkflowInput {
  message: string;
  history: AgentMessage[];
  context: {
    workspaceId: string;
    threadId: string;
    spaceId?: string;
    userId?: string;
    temporalUserId?: string;
    roleId?: string | null;
    languageId?: string;
    topK?: number;
  };
}

export interface WeatherInput {
  city: string;
}

// Customer-defined tool. Lives entirely in this worker — sharelyai-be doesn't
// know it exists. Backed by wttr.in (free, no API key).
export const getWeather = async ({
  city,
}: WeatherInput): Promise<Record<string, unknown>> => {
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
};
