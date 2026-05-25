// Runnable proof for the Temporal-backed handler.
//
// Drives @sharely/adapter-temporal end-to-end with a fake Temporal client
// whose "workflow" is in-process: scripted AgentEvents pushed into a
// createAgentEventSink() buffer that the polling handler queries. No
// Temporal server or worker needed.
//
//   npx turbo run build
//   node examples/adapter-temporal/smoke.mjs

import { validateEventStream } from '@sharelyai/conformance';
import {
  fromTemporal,
  createAgentEventSink,
  emitAgentEvent,
} from '@sharelyai/adapter-temporal';

// ---------- Fake Temporal client ----------
// `start()` spins up a per-execution sink and returns a handle whose `query`
// drip-feeds the scripted events into the sink across multiple poll cycles —
// exercises the polling handler's cursor advancement.

const fakeTemporalClient = scriptedEvents => ({
  start: async () => {
    const sink = createAgentEventSink();
    let emittedCount = 0;
    return {
      query: async (_queryName, cursor) => {
        const next = scriptedEvents.slice(emittedCount, emittedCount + 2);
        for (const e of next) emitAgentEvent(sink, e);
        emittedCount += next.length;
        return sink.query(cursor);
      },
      cancel: async () => {},
    };
  },
});

// What the customer's *workflow* would emit via emitAgentEvent(sink, ...).
const scriptedEvents = [
  { type: 'message_start', role: 'assistant', model: 'temporal-fake-smoke' },
  { type: 'content_delta', delta: 'Let me check. ' },
  {
    type: 'tool_call_start',
    toolCallId: 'tc1',
    name: 'lookup',
    input: { q: 'x' },
  },
  {
    type: 'tool_call_end',
    toolCallId: 'tc1',
    output: { answer: 42 },
    durationMs: 5,
  },
  { type: 'content_delta', delta: 'Result: 42.' },
  {
    type: 'sources',
    sources: [
      {
        id: 'src-1',
        type: 'knowledge',
        title: 'Doc',
        url: 'https://example.com/doc',
      },
    ],
  },
  { type: 'content_end' },
  {
    type: 'message_end',
    finishReason: 'stop',
    tokenUsage: { inputTokens: 18, outputTokens: 9, totalTokens: 27 },
  },
];

const handler = fromTemporal({
  client: fakeTemporalClient(scriptedEvents),
  workflowType: 'sharelyAgentWorkflow',
  taskQueue: 'sharely-agents',
  pollIntervalMs: 1,
});

// ---------- Exercise ----------

const collected = [];
const input = {
  message: "what's the answer?",
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
  'content_delta',
  'tool_call_start',
  'tool_call_end',
  'content_delta',
  'sources',
  'content_end',
  'message_end',
];

const orderOk =
  expected.length === types.length && expected.every((t, i) => types[i] === t);

const me = collected[collected.length - 1];
const tokensOk =
  me?.type === 'message_end' && me.tokenUsage?.totalTokens === 27;

const tcStart = collected.find(e => e.type === 'tool_call_start');
const tcEnd = collected.find(e => e.type === 'tool_call_end');
const toolOk =
  tcStart?.toolCallId === 'tc1' &&
  tcStart?.name === 'lookup' &&
  tcStart?.input?.q === 'x' &&
  tcEnd?.output?.answer === 42;

const sourcesEvent = collected.find(e => e.type === 'sources');
const sourcesOk =
  sourcesEvent?.sources?.length === 1 && sourcesEvent.sources[0].id === 'src-1';

// Abort check: aborting partway should call cancel() on the workflow handle.
let cancelled = false;
const abortClient = {
  start: async () => ({
    query: async () => ({ events: [], done: false, cursor: 0 }),
    cancel: async () => {
      cancelled = true;
    },
  }),
};
const abortHandler = fromTemporal({
  client: abortClient,
  workflowType: 'w',
  taskQueue: 'q',
  pollIntervalMs: 5,
});
const ac = new AbortController();
const it = abortHandler({
  message: 'x',
  history: [],
  context: { threadId: 't', trace: { messageId: 'm' } },
  signal: ac.signal,
})[Symbol.asyncIterator]();
const first = it.next();
ac.abort();
await first;
await it.next();
const abortOk = cancelled;

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
  'abort cancels:     ',
  abortOk ? 'PASS' : 'FAIL (workflow handle was not cancelled)',
);

const allOk =
  structural.ok && orderOk && tokensOk && toolOk && sourcesOk && abortOk;
console.log(allOk ? '\nall checks passed' : '\nSMOKE FAILED');
process.exit(allOk ? 0 : 1);
