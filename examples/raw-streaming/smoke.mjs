// Runnable proof for the raw Pattern C handler.
//
// handler.ts is the customer-form code (TypeScript). This .mjs inlines the
// same logic in JS so the example runs without a TS build. If you change
// handler.ts, mirror the change here.
//
//   npx turbo run build --filter=@sharely/conformance
//   node examples/raw-streaming/smoke.mjs

import { validateEventStream } from '@sharelyai/conformance';

// ---------- JS port of the rawHandler (handler.ts) ----------

const runLLMTurn = async (input, prevToolOutput, iter) => {
  if (iter === 0) {
    return {
      thinking: 'I should look this up.',
      text: 'Let me check. ',
      toolCall: { id: 'tc1', name: 'lookup', input: { q: input.message } },
      usage: { inputTokens: 12, outputTokens: 8 },
    };
  }
  return {
    thinking: null,
    text: `The answer is ${prevToolOutput?.answer ?? 'unknown'}.`,
    toolCall: null,
    usage: { inputTokens: 30, outputTokens: 7 },
    finishReason: 'stop',
  };
};

const runTool = async (name, args) => {
  if (name !== 'lookup') return { error: `Unknown tool: ${name}` };
  return {
    output: { answer: 42, query: args.q },
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

const chunked = function* (s, size) {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
};

const rawHandler = async function* (input) {
  yield { type: 'message_start', role: 'assistant', model: 'raw-v1' };

  let inputTokens = 0;
  let outputTokens = 0;
  const collectedSources = [];
  let lastToolOutput = null;
  let finishReason = 'stop';

  for (let iter = 0; iter < 10; iter++) {
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

    for (const chunk of chunked(turn.text, 16)) {
      if (input.signal.aborted) return;
      yield { type: 'content_delta', delta: chunk };
    }

    if (turn.toolCall) {
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

      continue;
    }

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

// ---------- Exercise ----------

const collected = [];
const input = {
  message: 'what is the answer?',
  history: [],
  context: {
    workspaceId: 'ws',
    threadId: 't',
    authorization: 'Bearer x',
    api: { baseUrl: 'x', workspaceId: 'ws' },
    trace: {
      traceId: 'tr',
      messageId: 'm',
      event() {},
      child() {
        return this;
      },
      end() {},
    },
  },
  signal: new AbortController().signal,
};

for await (const e of rawHandler(input)) collected.push(e);

console.log('Stream:');
for (const e of collected)
  console.log(' ', e.type, JSON.stringify(e).slice(0, 100));

// ---------- Assertions ----------

const structural = validateEventStream(collected);
const types = collected.map(e => e.type);

// Expected progression across two turns:
//   message_start
//   thinking_start, thinking_delta, thinking_end   (turn 0)
//   content_delta x N "Let me check. "             (turn 0)
//   tool_call_start, tool_call_end                 (turn 0)
//   content_delta x N "The answer is 42."          (turn 1)
//   sources
//   content_end
//   message_end

const headerOk = types[0] === 'message_start';
const thinkingOk =
  types[1] === 'thinking_start' &&
  types[2] === 'thinking_delta' &&
  types[3] === 'thinking_end';

// Find the tool call boundary — content before/after it comes from turn 0 / turn 1.
const tcStartIdx = types.indexOf('tool_call_start');
const tcEndIdx = types.indexOf('tool_call_end');
const toolPositionOk =
  tcStartIdx > 3 &&
  tcEndIdx === tcStartIdx + 1 &&
  // turn 0 content_deltas come between thinking_end (idx 3) and tool_call_start
  types.slice(4, tcStartIdx).every(t => t === 'content_delta') &&
  tcStartIdx > 4 &&
  // turn 1 content_deltas come after tool_call_end and before sources
  types
    .slice(tcEndIdx + 1, types.indexOf('sources'))
    .every(t => t === 'content_delta');

const sourcesIdx = types.indexOf('sources');
const contentEndIdx = types.indexOf('content_end');
const messageEndIdx = types.indexOf('message_end');
const tailOk =
  sourcesIdx > tcEndIdx &&
  sourcesIdx === contentEndIdx - 1 &&
  contentEndIdx === messageEndIdx - 1 &&
  messageEndIdx === types.length - 1;

const sourcesEvent = collected.find(e => e.type === 'sources');
const sourcesShapeOk =
  sourcesEvent?.sources?.length === 1 && sourcesEvent.sources[0].id === 'src-1';

// Reassembled content should be both turns concatenated.
const reassembled = collected
  .filter(e => e.type === 'content_delta')
  .map(e => e.delta)
  .join('');
const expectedReassembly = 'Let me check. The answer is 42.';
const reassembleOk = reassembled === expectedReassembly;

// Tokens accumulate across both turns: (12+30) input + (8+7) output = 57 total.
const me = collected[collected.length - 1];
const tokensOk =
  me?.type === 'message_end' &&
  me.tokenUsage?.inputTokens === 42 &&
  me.tokenUsage?.outputTokens === 15 &&
  me.tokenUsage?.totalTokens === 57;

// Tool input survives the loop: the second turn's text used the tool result.
const tcEnd = collected[tcEndIdx];
const toolRoundtripOk =
  tcEnd?.output?.answer === 42 && reassembled.includes('42');

// Abort check: pre-aborted signal halts after the first content_delta loop iteration.
const abortedCollected = [];
const aborted = new AbortController();
aborted.abort();
for await (const e of rawHandler({ ...input, signal: aborted.signal })) {
  abortedCollected.push(e);
  if (abortedCollected.length > 12) break;
}
const abortOk = !abortedCollected.some(e =>
  ['sources', 'content_end', 'message_end'].includes(e.type),
);

console.log('\n--- assertions ---');
console.log(
  'structural:        ',
  structural.ok ? 'PASS' : `FAIL: ${structural.errors.join('; ')}`,
);
console.log(
  'header order:      ',
  headerOk ? 'PASS' : `FAIL (got [0]=${types[0]})`,
);
console.log(
  'thinking trio:     ',
  thinkingOk ? 'PASS' : `FAIL (got [1..3]=${types.slice(1, 4).join(', ')})`,
);
console.log(
  'tool position:     ',
  toolPositionOk ? 'PASS' : `FAIL (tcStart@${tcStartIdx}, tcEnd@${tcEndIdx})`,
);
console.log(
  'tail order:        ',
  tailOk
    ? 'PASS'
    : `FAIL (sources@${sourcesIdx}, content_end@${contentEndIdx}, message_end@${messageEndIdx})`,
);
console.log(
  'reassembles 2 turns:',
  reassembleOk
    ? 'PASS'
    : `FAIL\n   expected: ${expectedReassembly}\n   got:      ${reassembled}`,
);
console.log(
  'sources shape:     ',
  sourcesShapeOk ? 'PASS' : `FAIL (${JSON.stringify(sourcesEvent)})`,
);
console.log(
  'tokens summed:     ',
  tokensOk ? 'PASS' : `FAIL (got ${JSON.stringify(me?.tokenUsage)})`,
);
console.log(
  'tool round-trip:   ',
  toolRoundtripOk ? 'PASS' : `FAIL (output=${JSON.stringify(tcEnd?.output)})`,
);
console.log(
  'abort halts:       ',
  abortOk
    ? 'PASS'
    : `FAIL (got ${abortedCollected.map(e => e.type).join(', ')})`,
);

const allOk =
  structural.ok &&
  headerOk &&
  thinkingOk &&
  toolPositionOk &&
  tailOk &&
  reassembleOk &&
  sourcesShapeOk &&
  tokensOk &&
  toolRoundtripOk &&
  abortOk;
console.log(allOk ? '\nall checks passed' : '\nSMOKE FAILED');
process.exit(allOk ? 0 : 1);
