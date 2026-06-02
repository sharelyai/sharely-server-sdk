// Activities run in the worker's Node process (NOT the deterministic workflow
// sandbox), so I/O — fetch, env vars, timers — is allowed here. This activity
// drives a raw OpenAI tool-calling loop with `fetch` (no LLM SDK) and returns
// the resulting Sharely `AgentEvent`s. The workflow then relays them into the
// adapter's event-buffer sink. Keeping the loop in an activity is what makes
// the turn durable: if the worker crashes mid-call, Temporal retries it.

import { Context } from '@temporalio/activity';
import type { AgentEvent, AgentMessage } from '@sharelyai/protocol';

const MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-5.4-mini';
const MAX_STEPS = 8;

// Customer-defined tool. Lives entirely in this worker — sharelyai-be doesn't
// know it exists. Backed by wttr.in (free, no API key).
const getWeather = async (
  city: string,
): Promise<Record<string, unknown>> => {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
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

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        'Get the current weather for a city. Use this when the user asks about weather or temperature in a specific location.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name, e.g. "Berlin"' },
        },
        required: ['city'],
      },
    },
  },
];

const SYSTEM_PROMPT =
  'You are a helpful Sharely agent running inside a durable Temporal workflow. ' +
  'Use get_weather for weather or temperature questions. After a tool returns, ' +
  'summarize the result for the user in natural language.';

const runTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  if (name === 'get_weather') return getWeather(String(args['city'] ?? ''));
  return { error: `unknown tool: ${name}` };
};

/** Serializable subset of AgentContext handed to the workflow, forwarded here. */
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

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

/**
 * Raw OpenAI tool-calling loop. Returns the full AgentEvent stream for one turn:
 * `message_start` … `content_delta`/`tool_call_*` … `content_end` `message_end`,
 * or a single `error` event on failure. Honors Temporal activity cancellation.
 */
export const runAgent = async (
  input: WorkflowInput,
): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    events.push({ type: 'error', error: 'Missing required env var: OPENAI_API_KEY' });
    return events;
  }

  const signal = Context.current().cancellationSignal;
  events.push({ type: 'message_start', role: 'assistant', model: MODEL });

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...input.history.map(m => ({ role: m.role, content: m.content ?? '' })),
    { role: 'user', content: input.message },
  ];

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      Context.current().heartbeat(`step ${step}`);

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
        }),
        signal,
      });

      if (!res.ok) {
        events.push({
          type: 'error',
          error: `openai ${res.status}: ${(await res.text()).slice(0, 300)}`,
        });
        return events;
      }

      const data = (await res.json()) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ message?: ChatMessage }>;
      };
      if (data.usage) {
        inputTokens += data.usage.prompt_tokens ?? 0;
        outputTokens += data.usage.completion_tokens ?? 0;
      }

      const msg = data.choices?.[0]?.message;
      if (!msg) {
        events.push({ type: 'error', error: 'openai returned no message' });
        return events;
      }
      messages.push(msg);

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments || '{}') as Record<
            string,
            unknown
          >;
          events.push({
            type: 'tool_call_start',
            toolCallId: tc.id,
            name: tc.function.name,
            input: args,
          });
          const started = Date.now();
          let output: unknown;
          let error: string | undefined;
          try {
            output = await runTool(tc.function.name, args);
          } catch (e) {
            error = e instanceof Error ? e.message : 'tool failed';
          }
          events.push({
            type: 'tool_call_end',
            toolCallId: tc.id,
            output,
            error,
            durationMs: Date.now() - started,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(output ?? { error }),
          });
        }
        continue; // let the model use the tool results
      }

      const content = msg.content ?? '';
      if (content) events.push({ type: 'content_delta', delta: content });
      break;
    }

    events.push({ type: 'content_end' });
    events.push({
      type: 'message_end',
      finishReason: 'stop',
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
    return events;
  } catch (err) {
    events.push({
      type: 'error',
      error: err instanceof Error ? err.message : 'agent activity failed',
    });
    return events;
  }
};
