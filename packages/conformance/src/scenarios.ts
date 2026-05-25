import type { AgentEvent } from '@sharelyai/protocol';

export interface ConformanceScenario {
  name: string;
  description: string;
  /** The message the Handler is invoked with. */
  inputMessage: string;
  /** The exact AgentEvent sequence a conformant Handler must yield. */
  golden: AgentEvent[];
}

const usage = { inputTokens: 8, outputTokens: 4, totalTokens: 12 };

/**
 * The reference scenarios. Each golden stream is the exact sequence a
 * conformant Handler must yield — kept minimal and adapter-neutral so a Vercel
 * AI stream and a Temporal workflow can both produce it. The hosted
 * `runAgentLoop` emits a superset of these shapes; conformance asserts the
 * *contract*, not byte-equality with the hosted runtime.
 */
export const scenarios: Record<string, ConformanceScenario> = {
  textOnly: {
    name: 'text-only',
    description: 'Plain text answer, no tools, no thinking.',
    inputMessage: 'say hello',
    golden: [
      { type: 'message_start', role: 'assistant', model: 'conformance' },
      { type: 'content_delta', delta: 'Hello, ' },
      { type: 'content_delta', delta: 'world.' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ],
  },

  thinking: {
    name: 'thinking',
    description: 'A thinking step precedes the answer.',
    inputMessage: 'think then answer',
    golden: [
      { type: 'message_start', role: 'assistant', model: 'conformance' },
      { type: 'thinking_start', thinkingId: 't1', title: 'Reasoning' },
      { type: 'thinking_delta', thinkingId: 't1', delta: 'Considering...' },
      {
        type: 'thinking_end',
        thinkingId: 't1',
        status: 'completed',
        durationMs: 30,
      },
      { type: 'content_delta', delta: 'Done.' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ],
  },

  toolCall: {
    name: 'tool-call',
    description: 'One tool call, then a cited answer.',
    inputMessage: 'look it up',
    golden: [
      { type: 'message_start', role: 'assistant', model: 'conformance' },
      {
        type: 'tool_call_start',
        toolCallId: 'tc1',
        name: 'search_knowledge',
        input: { query: 'topic' },
      },
      {
        type: 'tool_call_end',
        toolCallId: 'tc1',
        output: { totalResults: 1 },
        durationMs: 20,
      },
      { type: 'content_delta', delta: 'Per the docs.' },
      {
        type: 'sources',
        sources: [{ id: 'k1', type: 'knowledge', title: 'Doc' }],
      },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ],
  },

  error: {
    name: 'error',
    description: 'The agent fails mid-turn and emits an error event.',
    inputMessage: 'trigger a failure',
    golden: [
      { type: 'message_start', role: 'assistant', model: 'conformance' },
      { type: 'error', error: 'upstream model unavailable' },
    ],
  },
};

export const allScenarios: ConformanceScenario[] = Object.values(scenarios);
