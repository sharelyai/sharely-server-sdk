// Pattern C — truly raw Sharely `Handler`. No framework, no factory, no
// wrapper. Just an async generator that yields AgentEvents.
//
// Copy this into your project. You will need:
//   npm i @sharely/protocol
//
// Use this shape when you have a non-streaming LLM (chunk the final string),
// a custom upstream protocol (bridge it to AgentEvents), or you want zero
// abstraction overhead. The body below shows a real multi-turn agent loop
// (model → optional tool call → model → answer) with thinking, tool
// streaming, batched sources, and aggregated token usage.

import type { AgentInput, Handler, Source } from '@sharelyai/protocol';

export const rawHandler: Handler = async function* (input) {
  yield { type: 'message_start', role: 'assistant', model: 'raw-v1' };

  let inputTokens = 0;
  let outputTokens = 0;
  const collectedSources: Source[] = [];
  let lastToolOutput: unknown = null;
  let finishReason = 'stop';

  for (let iter = 0; iter < 10; iter++) {
    // Replace runLLMTurn with your real model call. It returns whatever your
    // upstream LLM produced: thinking text, streamed answer text, optionally
    // a tool call, and usage counters.
    const turn = await runLLMTurn(input, lastToolOutput, iter);
    inputTokens += turn.usage.inputTokens;
    outputTokens += turn.usage.outputTokens;

    if (turn.thinking) {
      const tid = `t-${iter}`;
      yield { type: 'thinking_start', thinkingId: tid, title: 'Reasoning' };
      yield { type: 'thinking_delta', thinkingId: tid, delta: turn.thinking };
      yield {
        type: 'thinking_end',
        thinkingId: tid,
        status: 'completed',
        durationMs: 0,
      };
    }

    // Stream the answer text — real handlers yield as their upstream source
    // produces chunks. Honor input.signal between yields so client disconnects
    // propagate.
    for (const chunk of chunked(turn.text, 16)) {
      if (input.signal.aborted) return;
      yield { type: 'content_delta', delta: chunk };
    }

    if (turn.toolCall) {
      // The protocol has no partial-input event — `tool_call_start` carries the
      // fully-parsed input. If your upstream streams arguments as JSON
      // fragments, buffer them yourself and yield this when the call closes.
      const started = Date.now();
      yield {
        type: 'tool_call_start',
        toolCallId: turn.toolCall.id,
        name: turn.toolCall.name,
        input: turn.toolCall.input,
      };

      const result = await runTool(turn.toolCall.name, turn.toolCall.input);
      lastToolOutput = result.output;
      if (result.sources?.length) collectedSources.push(...result.sources);

      yield {
        type: 'tool_call_end',
        toolCallId: turn.toolCall.id,
        ...(result.error ? { error: result.error } : { output: result.output }),
        durationMs: Date.now() - started,
      };

      // Loop back: next iteration feeds the tool result back to the LLM.
      continue;
    }

    // No tool call → the model finished. Exit the loop.
    finishReason = turn.finishReason ?? 'stop';
    break;
  }

  if (collectedSources.length > 0) {
    yield { type: 'sources', sources: collectedSources };
  }
  yield { type: 'content_end' };
  yield {
    type: 'message_end',
    finishReason,
    tokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
};

// ---------- Replace these stubs with your real LLM + tool calls ----------

interface LLMTurn {
  thinking: string | null;
  text: string;
  toolCall: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  } | null;
  usage: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

// Stub: simulates an LLM that wants to call `lookup` on turn 0 and answers
// using the tool's output on turn 1.
const runLLMTurn = async (
  input: AgentInput,
  prevToolOutput: unknown,
  iter: number,
): Promise<LLMTurn> => {
  if (iter === 0) {
    return {
      thinking: 'I should look this up.',
      text: 'Let me check. ',
      toolCall: { id: 'tc1', name: 'lookup', input: { q: input.message } },
      usage: { inputTokens: 12, outputTokens: 8 },
    };
  }
  const answer =
    (prevToolOutput as { answer?: number } | null)?.answer ?? 'unknown';
  return {
    thinking: null,
    text: `The answer is ${answer}.`,
    toolCall: null,
    usage: { inputTokens: 30, outputTokens: 7 },
    finishReason: 'stop',
  };
};

const runTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<{
  output?: unknown;
  error?: string;
  sources?: Source[];
}> => {
  if (name !== 'lookup') return { error: `Unknown tool: ${name}` };
  return {
    output: { answer: 42, query: args['q'] },
    sources: [
      {
        id: 'src-1',
        type: 'knowledge',
        title: 'Reference doc',
        url: 'https://example.com/doc',
      },
    ],
  };
};

const chunked = function* (s: string, size: number): Iterable<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
};
