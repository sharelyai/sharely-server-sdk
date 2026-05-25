// Runnable proof for the Vercel AI–backed handler.
//
// Drives @sharelyai/adapter-vercel-ai's fromVercelAI() with a hand-built fake
// `streamText` result that emits the Vercel `fullStream` part types — no
// model API key needed. Mirrors what packages/adapter-vercel-ai/examples/
// conformance.mjs does, but framed as a customer-usage demo.
//
//   npx turbo run build
//   node examples/adapter-vercel-ai/smoke.mjs

import { validateEventStream } from '@sharelyai/conformance';
import { fromVercelAI } from '@sharelyai/adapter-vercel-ai';

// ---------- Fake `streamText` result ----------
// Per the structural shape adapter-vercel-ai consumes — just an object with
// a `fullStream` AsyncIterable of stream parts.

const fakeStream = parts => ({
  fullStream: (async function* () {
    for (const p of parts) yield p;
  })(),
});

// One run: text → tool_call → tool_result → text → finish.
const parts = [
  { type: 'text-delta', textDelta: 'Let me check. ' },
  {
    type: 'tool-call',
    toolCallId: 'tc1',
    toolName: 'semantic_search',
    args: { text: 'topic' },
  },
  {
    type: 'tool-result',
    toolCallId: 'tc1',
    result: { totalResults: 1, results: [{ id: 'k1', title: 'Doc' }] },
  },
  { type: 'text-delta', textDelta: 'Found one match.' },
  {
    type: 'source',
    source: { id: 'k1', title: 'Doc', url: 'https://example.com/k1' },
  },
  {
    type: 'finish',
    finishReason: 'stop',
    usage: { inputTokens: 18, outputTokens: 6, totalTokens: 24 },
  },
];

const handler = fromVercelAI(() => fakeStream(parts), {
  model: 'gateway/claude-fake-smoke',
});

// ---------- Exercise ----------

const collected = [];
const input = {
  message: 'find me something',
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

for await (const e of handler(input)) collected.push(e);

console.log('Stream:');
for (const e of collected)
  console.log(' ', e.type, JSON.stringify(e).slice(0, 100));

// ---------- Assertions ----------

const structural = validateEventStream(collected);
const types = collected.map(e => e.type);
const expected = [
  'message_start',
  'content_delta', // "Let me check. "
  'tool_call_start', // semantic_search
  'tool_call_end',
  'content_delta', // "Found one match."
  'sources', // from the `source` part
  'content_end',
  'message_end',
];

const orderOk =
  expected.length === types.length && expected.every((t, i) => types[i] === t);

const me = collected[collected.length - 1];
const tokensOk =
  me?.type === 'message_end' && me.tokenUsage?.totalTokens === 24;

const tcStart = collected.find(e => e.type === 'tool_call_start');
const tcEnd = collected.find(e => e.type === 'tool_call_end');
const toolOk =
  tcStart?.toolCallId === 'tc1' &&
  tcStart?.name === 'semantic_search' &&
  tcStart?.input?.text === 'topic' &&
  tcEnd?.output?.totalResults === 1;

const sourcesEvent = collected.find(e => e.type === 'sources');
const sourcesOk =
  sourcesEvent?.sources?.length === 1 &&
  sourcesEvent.sources[0].id === 'k1' &&
  sourcesEvent.sources[0].url === 'https://example.com/k1';

// Streaming check: tool call lands between the two content deltas.
const startIdx = collected.findIndex(e => e.type === 'tool_call_start');
const before = collected[startIdx - 1];
const after = collected[startIdx + 2]; // skip past tool_call_end
const streamingOk =
  before?.type === 'content_delta' &&
  before.delta === 'Let me check. ' &&
  after?.type === 'content_delta' &&
  after.delta === 'Found one match.';

console.log('\n--- assertions ---');
console.log(
  'structural:        ',
  structural.ok ? 'PASS' : `FAIL: ${structural.errors.join('; ')}`,
);
console.log(
  'event order:       ',
  orderOk
    ? 'PASS'
    : `FAIL\n   expected: ${expected.join(', ')}\n   got:      ${types.join(', ')}`,
);
console.log(
  'tokens forwarded:  ',
  tokensOk ? 'PASS' : `FAIL (got ${me?.tokenUsage?.totalTokens})`,
);
console.log(
  'tool round-trip:   ',
  toolOk
    ? 'PASS'
    : `FAIL (start=${JSON.stringify(tcStart)}, end=${JSON.stringify(tcEnd)})`,
);
console.log(
  'sources batched:   ',
  sourcesOk ? 'PASS' : `FAIL (${JSON.stringify(sourcesEvent)})`,
);
console.log(
  'streamed mid-run:  ',
  streamingOk
    ? 'PASS'
    : `FAIL (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`,
);

const allOk =
  structural.ok && orderOk && tokensOk && toolOk && sourcesOk && streamingOk;
console.log(allOk ? '\nall checks passed' : '\nSMOKE FAILED');
process.exit(allOk ? 0 : 1);
