// Runnable proof for the Pattern C OpenAI Agents handler.
//
// handler.ts is the customer-form code (imports @openai/agents). This .mjs
// inlines the same logic in JS so the example runs without a TS build or an
// OpenAI key. If you change handler.ts, mirror the change here.
//
//   npx turbo run build --filter=@sharely/conformance
//   node examples/openai-agents-sdk/smoke.mjs

import { validateEventStream } from '@sharelyai/conformance';

// ---------- JS port of createOpenAIAgentsHandler (handler.ts) ----------

const pickToolCallId = item => {
  const direct = item.callId ?? item.id;
  if (typeof direct === 'string' && direct) return direct;
  const fromRaw = item.rawItem?.callId ?? item.rawItem?.id;
  if (typeof fromRaw === 'string' && fromRaw) return fromRaw;
  throw new Error(
    'OpenAI Agents adapter: tool call id missing on run_item — SDK shape drifted. Update pickToolCallId for your @openai/agents version.',
  );
};

const pickToolName = item => {
  const direct = item.name;
  if (typeof direct === 'string' && direct) return direct;
  const fromRaw = item.rawItem?.name;
  if (typeof fromRaw === 'string' && fromRaw) return fromRaw;
  throw new Error(
    'OpenAI Agents adapter: tool name missing on run_item — SDK shape drifted. Update pickToolName for your @openai/agents version.',
  );
};

const pickToolInput = item => {
  const candidates = [item.arguments, item.input, item.rawItem?.arguments];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string') {
      try {
        return JSON.parse(c);
      } catch {
        /* try next */
      }
    } else if (typeof c === 'object') {
      return c;
    }
  }
  return {};
};

const createOpenAIAgentsHandler = ({ agent, model, maxTurns, run }) => {
  return async function* (input) {
    yield {
      type: 'message_start',
      role: 'assistant',
      model: model ?? 'openai-agents',
    };

    const runnerInput = [
      ...input.history.map(m => ({
        role: m.role,
        content: m.content ?? '',
      })),
      { role: 'user', content: input.message },
    ];

    let stream;
    try {
      stream = await run(agent, runnerInput, {
        stream: true,
        ...(maxTurns ? { maxTurns } : {}),
      });
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const onAbort = () => {
      try {
        stream.abort?.();
      } catch {
        /* noop */
      }
    };
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener('abort', onAbort, { once: true });

    const collectedSources = [];
    let inputTokens = 0;
    let outputTokens = 0;
    const finishReason = 'stop';

    try {
      for await (const event of stream) {
        if (input.signal.aborted) return;

        if (event.type === 'raw_model_stream_event') {
          const d = event.data ?? {};
          if (
            d.type === 'response.output_text.delta' &&
            typeof d.delta === 'string'
          ) {
            yield { type: 'content_delta', delta: d.delta };
          } else if (d.type === 'response.completed') {
            inputTokens += d.response?.usage?.input_tokens ?? 0;
            outputTokens += d.response?.usage?.output_tokens ?? 0;
          }
        } else if (event.type === 'run_item_stream_event') {
          const item = event.item ?? {};
          if (event.name === 'tool_called') {
            yield {
              type: 'tool_call_start',
              toolCallId: pickToolCallId(item),
              name: pickToolName(item),
              input: pickToolInput(item),
            };
          } else if (event.name === 'tool_output') {
            const output = item.output;
            if (output && typeof output === 'object' && 'sources' in output) {
              const ss = output.sources;
              if (Array.isArray(ss)) collectedSources.push(...ss);
            }
            yield {
              type: 'tool_call_end',
              toolCallId: pickToolCallId(item),
              output,
              durationMs: 0,
            };
          }
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
    } finally {
      input.signal.removeEventListener?.('abort', onAbort);
    }

    if (input.signal.aborted) return;
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
};

// ---------- Fake @openai/agents `run()` ----------
// Returns an async iterable that yields the scripted event list.

const fakeRun = events => {
  let aborted = false;
  return async () => ({
    abort: () => {
      aborted = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const ev of events) {
        if (aborted) return;
        yield ev;
      }
    },
  });
};

// ---------- Fixture: text → tool → text within one run ----------
// (The Agents SDK collapses multi-turn tool loops into a single `run()`,
//  so all events come from one stream rather than two streams like Anthropic.)

const events = [
  {
    type: 'raw_model_stream_event',
    data: { type: 'response.output_text.delta', delta: 'Let me check. ' },
  },
  {
    type: 'run_item_stream_event',
    name: 'tool_called',
    item: { name: 'lookup', callId: 'tc1', arguments: '{"q":"x"}' },
  },
  {
    type: 'raw_model_stream_event',
    data: { type: 'response.output_text.delta', delta: 'Looking now...' },
  },
  {
    type: 'run_item_stream_event',
    name: 'tool_output',
    item: {
      callId: 'tc1',
      output: {
        answer: 42,
        sources: [
          {
            id: 'src-1',
            type: 'knowledge',
            title: 'Reference doc',
            url: 'https://example.com/doc',
          },
        ],
      },
    },
  },
  {
    type: 'raw_model_stream_event',
    data: { type: 'response.output_text.delta', delta: 'Result: 42.' },
  },
  {
    type: 'raw_model_stream_event',
    data: {
      type: 'response.completed',
      response: { usage: { input_tokens: 30, output_tokens: 12 } },
    },
  },
];

const handler = createOpenAIAgentsHandler({
  agent: { name: 'fake' },
  model: 'gpt-fake-smoke',
  run: fakeRun(events),
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
  'content_delta', // "Let me check. "
  'tool_call_start', // lookup(q=x) — SDK-side, we just relay it
  'content_delta', // "Looking now..."
  'tool_call_end', // SDK ran the tool; output includes sources
  'content_delta', // "Result: 42."
  'sources', // accumulated from tool_output.output.sources
  'content_end',
  'message_end',
];

const orderOk =
  expected.length === types.length && expected.every((t, i) => types[i] === t);

const me = collected[collected.length - 1];
const expectedTotal = 30 + 12;
const tokensOk =
  me?.type === 'message_end' && me.tokenUsage?.totalTokens === expectedTotal;

const tcStart = collected.find(e => e.type === 'tool_call_start');
const tcEnd = collected.find(e => e.type === 'tool_call_end');
const toolOk =
  tcStart?.toolCallId === 'tc1' &&
  tcStart?.name === 'lookup' &&
  tcStart?.input?.q === 'x' &&
  tcEnd?.toolCallId === 'tc1' &&
  tcEnd?.output?.answer === 42;

const sourcesEvent = collected.find(e => e.type === 'sources');
const sourcesOk =
  sourcesEvent?.sources?.length === 1 &&
  sourcesEvent.sources[0].id === 'src-1' &&
  sourcesEvent.sources[0].url === 'https://example.com/doc';

// Streaming check: tool_call_start lands BETWEEN the two surrounding deltas,
// proving we're relaying SDK events as they arrive — not buffering until run end.
const startIdx = collected.findIndex(e => e.type === 'tool_call_start');
const before = collected[startIdx - 1];
const after = collected[startIdx + 1];
const streamingOk =
  before?.type === 'content_delta' &&
  before.delta === 'Let me check. ' &&
  after?.type === 'content_delta' &&
  after.delta === 'Looking now...';

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
  'token aggregation: ',
  tokensOk
    ? 'PASS'
    : `FAIL (got ${me?.tokenUsage?.totalTokens}, expected ${expectedTotal})`,
);
console.log(
  'tool relay:        ',
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
