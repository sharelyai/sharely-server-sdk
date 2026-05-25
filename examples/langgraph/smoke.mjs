// Runnable proof for the Pattern C LangGraph handler.
//
// handler.ts is the customer-form code (imports @langchain/langgraph). This
// .mjs inlines the same logic in JS so the example runs without a TS build
// or any LangChain deps. If you change handler.ts, mirror the change here.
//
//   npx turbo run build --filter=@sharely/conformance
//   node examples/langgraph/smoke.mjs

import { validateEventStream } from '@sharely/conformance';

// ---------- JS port of createLangGraphHandler (handler.ts) ----------

const extractTextContent = chunk => {
  if (!chunk || typeof chunk !== 'object') return '';
  const content = chunk.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && typeof c === 'object' && c.type === 'text')
      .map(c => c.text ?? '')
      .join('');
  }
  return '';
};

const extractUsage = output => {
  if (!output || typeof output !== 'object') return { input: 0, output: 0 };
  const meta = output.usage_metadata;
  return {
    input: meta?.input_tokens ?? 0,
    output: meta?.output_tokens ?? 0,
  };
};

const extractToolInput = raw => {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === 'object') {
    if (raw.input && typeof raw.input === 'object') return raw.input;
    return raw;
  }
  return {};
};

const pickToolCallId = event => {
  if (typeof event.run_id === 'string' && event.run_id) return event.run_id;
  throw new Error(
    'LangGraph adapter: tool event missing run_id — streamEvents version drifted. Update pickToolCallId.',
  );
};

const pickToolName = event => {
  if (typeof event.name === 'string' && event.name) return event.name;
  throw new Error(
    'LangGraph adapter: tool event missing name — streamEvents version drifted. Update pickToolName.',
  );
};

const defaultBuildInput = input => ({
  messages: [
    ...input.history.map(m => ({ role: m.role, content: m.content ?? '' })),
    { role: 'user', content: input.message },
  ],
});

const createLangGraphHandler = ({
  graph, model, buildInput = defaultBuildInput,
}) => {
  return async function* (input) {
    yield {
      type: 'message_start',
      role: 'assistant',
      model: model ?? 'langgraph',
    };

    const collectedSources = [];
    let inputTokens = 0;
    let outputTokens = 0;
    const finishReason = 'stop';

    try {
      const stream = graph.streamEvents(buildInput(input), {
        version: 'v2',
        signal: input.signal,
      });

      for await (const event of stream) {
        if (input.signal.aborted) return;

        if (event.event === 'on_chat_model_stream') {
          const delta = extractTextContent(event.data?.chunk);
          if (delta) yield { type: 'content_delta', delta };
        } else if (event.event === 'on_chat_model_end') {
          const usage = extractUsage(event.data?.output);
          inputTokens += usage.input;
          outputTokens += usage.output;
        } else if (event.event === 'on_tool_start') {
          yield {
            type: 'tool_call_start',
            toolCallId: pickToolCallId(event),
            name: pickToolName(event),
            input: extractToolInput(event.data?.input),
          };
        } else if (event.event === 'on_tool_end') {
          const output = event.data?.output;
          if (output && typeof output === 'object' && 'sources' in output) {
            const ss = output.sources;
            if (Array.isArray(ss)) collectedSources.push(...ss);
          }
          yield {
            type: 'tool_call_end',
            toolCallId: pickToolCallId(event),
            output,
            durationMs: 0,
          };
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      return;
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

// ---------- Fake LangGraph graph ----------

const fakeGraph = events => ({
  streamEvents: () => ({
    async *[Symbol.asyncIterator]() {
      for (const ev of events) yield ev;
    },
  }),
});

// ---------- Fixture: text → tool → text within one streamEvents run ----------

const events = [
  {
    event: 'on_chat_model_stream',
    data: { chunk: { content: 'Let me check. ' } },
  },
  {
    event: 'on_tool_start',
    name: 'lookup',
    run_id: 'tc1',
    data: { input: { q: 'x' } },
  },
  {
    event: 'on_chat_model_stream',
    data: { chunk: { content: 'Looking now...' } },
  },
  {
    event: 'on_tool_end',
    name: 'lookup',
    run_id: 'tc1',
    data: {
      output: {
        answer: 42,
        sources: [
          {
            id: 'src-1', type: 'knowledge',
            title: 'Reference doc', url: 'https://example.com/doc',
          },
        ],
      },
    },
  },
  {
    event: 'on_chat_model_stream',
    data: { chunk: { content: 'Result: 42.' } },
  },
  {
    event: 'on_chat_model_end',
    data: { output: { usage_metadata: { input_tokens: 30, output_tokens: 12 } } },
  },
];

const handler = createLangGraphHandler({
  graph: fakeGraph(events),
  model: 'lg-fake-smoke',
});

// ---------- Exercise ----------

const collected = [];
const input = {
  message: "what's the answer?",
  history: [],
  context: {
    workspaceId: 'ws', threadId: 't', authorization: 'Bearer x',
    api: { baseUrl: 'x', workspaceId: 'ws' },
    trace: { traceId: 'tr', messageId: 'm', event() {}, child() { return this; }, end() {} },
  },
  signal: new AbortController().signal,
};

for await (const e of handler(input)) collected.push(e);

console.log('Stream:');
for (const e of collected) console.log(' ', e.type, JSON.stringify(e).slice(0, 100));

// ---------- Assertions ----------

const structural = validateEventStream(collected);
const types = collected.map(e => e.type);
const expected = [
  'message_start',
  'content_delta',   // "Let me check. "
  'tool_call_start', // lookup(q=x) — observed from on_tool_start
  'content_delta',   // "Looking now..."
  'tool_call_end',   // on_tool_end; output includes sources
  'content_delta',   // "Result: 42."
  'sources',         // accumulated from tool output.sources
  'content_end',
  'message_end',
];

const orderOk =
  expected.length === types.length &&
  expected.every((t, i) => types[i] === t);

const me = collected[collected.length - 1];
const expectedTotal = 30 + 12;
const tokensOk =
  me?.type === 'message_end' &&
  me.tokenUsage?.totalTokens === expectedTotal;

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

const startIdx = collected.findIndex(e => e.type === 'tool_call_start');
const before = collected[startIdx - 1];
const after = collected[startIdx + 1];
const streamingOk =
  before?.type === 'content_delta' && before.delta === 'Let me check. ' &&
  after?.type === 'content_delta' && after.delta === 'Looking now...';

console.log('\n--- assertions ---');
console.log('structural:        ', structural.ok ? 'PASS' : `FAIL: ${structural.errors.join('; ')}`);
console.log('event order:       ', orderOk ? 'PASS' : `FAIL\n   expected: ${expected.join(', ')}\n   got:      ${types.join(', ')}`);
console.log('token aggregation: ', tokensOk ? 'PASS' : `FAIL (got ${me?.tokenUsage?.totalTokens}, expected ${expectedTotal})`);
console.log('tool relay:        ', toolOk ? 'PASS' : `FAIL (start=${JSON.stringify(tcStart)}, end=${JSON.stringify(tcEnd)})`);
console.log('sources batched:   ', sourcesOk ? 'PASS' : `FAIL (${JSON.stringify(sourcesEvent)})`);
console.log('streamed mid-run:  ', streamingOk ? 'PASS' : `FAIL (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`);

const allOk = structural.ok && orderOk && tokensOk && toolOk && sourcesOk && streamingOk;
console.log(allOk ? '\nall checks passed' : '\nSMOKE FAILED');
process.exit(allOk ? 0 : 1);
