// Runnable proof for the Pattern C Anthropic handler.
//
// Why this file exists: handler.ts is the customer-form code (TypeScript,
// reads cleanly, depends on @anthropic-ai/sdk). This .mjs inlines the same
// logic in JS so the example runs without a TypeScript build or an Anthropic
// API key. If you change handler.ts, mirror the change here.
//
//   npx turbo run build --filter=@sharely/conformance
//   node examples/anthropic-sdk-direct/smoke.mjs

import { validateEventStream } from '@sharelyai/conformance';

// ---------- JS port of createAnthropicHandler (handler.ts) ----------

const createAnthropicHandler = ({
  client,
  model,
  systemPrompt,
  tools = [],
  maxIterations = 10,
  maxTokens = 4096,
}) => {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  const apiTools =
    tools.length > 0
      ? tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }))
      : undefined;

  return async function* (input) {
    const messages = [
      ...input.history.map(m => ({ role: m.role, content: m.content ?? '' })),
      { role: 'user', content: input.message },
    ];

    yield { type: 'message_start', role: 'assistant', model };

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'stop';
    const collectedSources = [];

    for (let i = 0; i < maxIterations; i++) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(apiTools ? { tools: apiTools } : {}),
          messages,
        },
        { signal: input.signal },
      );

      const openThinking = new Map();
      const openToolUse = new Map();

      for await (const event of stream) {
        if (input.signal.aborted) return;

        switch (event.type) {
          case 'message_start':
            inputTokens += event.message?.usage?.input_tokens ?? 0;
            break;

          case 'content_block_start': {
            const cb = event.content_block;
            if (cb.type === 'thinking') {
              const tid = `think-${i}-${event.index}`;
              openThinking.set(event.index, tid);
              yield {
                type: 'thinking_start',
                thinkingId: tid,
                title: 'Reasoning',
              };
            } else if (cb.type === 'tool_use') {
              openToolUse.set(event.index, {
                id: cb.id,
                name: cb.name,
                inputJson: '',
              });
            }
            break;
          }

          case 'content_block_delta': {
            const d = event.delta;
            if (d.type === 'text_delta') {
              yield { type: 'content_delta', delta: d.text };
            } else if (d.type === 'thinking_delta') {
              const tid = openThinking.get(event.index);
              if (tid)
                yield {
                  type: 'thinking_delta',
                  thinkingId: tid,
                  delta: d.thinking,
                };
            } else if (d.type === 'input_json_delta') {
              const tu = openToolUse.get(event.index);
              if (tu) tu.inputJson += d.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            const tid = openThinking.get(event.index);
            if (tid) {
              yield {
                type: 'thinking_end',
                thinkingId: tid,
                status: 'completed',
                durationMs: 0,
              };
              openThinking.delete(event.index);
            }
            const tu = openToolUse.get(event.index);
            if (tu) {
              let parsedInput = {};
              if (tu.inputJson) {
                try {
                  parsedInput = JSON.parse(tu.inputJson);
                } catch {
                  /* leave {} */
                }
              }
              yield {
                type: 'tool_call_start',
                toolCallId: tu.id,
                name: tu.name,
                input: parsedInput,
              };
              openToolUse.delete(event.index);
            }
            break;
          }

          case 'message_delta':
            if (event.delta?.stop_reason)
              finishReason = event.delta.stop_reason;
            outputTokens += event.usage?.output_tokens ?? 0;
            break;
        }
      }

      const final = await stream.finalMessage();
      messages.push({ role: 'assistant', content: final.content });

      const toolUses = final.content.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

      const toolResults = [];
      for (const tu of toolUses) {
        const t = toolMap.get(tu.name);
        const started = Date.now();
        // tool_call_start was already yielded during the stream.
        let output, error;
        try {
          if (!t) throw new Error(`Unknown tool: ${tu.name}`);
          const result = await t.execute(tu.input);
          output = result.output;
          error = result.error;
          if (result.sources?.length) collectedSources.push(...result.sources);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        yield error
          ? {
              type: 'tool_call_end',
              toolCallId: tu.id,
              error,
              durationMs: Date.now() - started,
            }
          : {
              type: 'tool_call_end',
              toolCallId: tu.id,
              output,
              durationMs: Date.now() - started,
            };

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(error ? { error } : (output ?? null)),
          ...(error ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: toolResults });
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
};

// ---------- Fake Anthropic client ----------
// Replays scripted turns. Each turn is { events, finalContent, usage, stopReason }.

const fakeAnthropic = turns => {
  let turnIdx = 0;
  return {
    messages: {
      stream: () => {
        const turn = turns[turnIdx++];
        if (!turn) throw new Error('fake Anthropic client ran out of turns');
        const finalMessage = {
          content: turn.finalContent,
          stop_reason: turn.stopReason,
          usage: turn.usage,
        };
        const iter = {
          async *[Symbol.asyncIterator]() {
            for (const ev of turn.events) yield ev;
          },
          finalMessage: async () => finalMessage,
        };
        return iter;
      },
    },
  };
};

// ---------- Fixtures: tool call → final answer ----------

const turns = [
  {
    // Turn 1: text → tool_use → MORE text → stop. Streaming the tool call
    // input means tool_call_start fires between the two content_deltas, not
    // after the whole stream ends.
    events: [
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Let me check. ' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'tu_1',
          name: 'lookup',
          input: {},
        },
      },
      // Two input_json_delta chunks — exercises the partial_json buffer.
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"x"}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: 'Looking now...' },
      },
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 8 },
      },
    ],
    finalContent: [
      { type: 'text', text: 'Let me check. ' },
      { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { q: 'x' } },
      { type: 'text', text: 'Looking now...' },
    ],
    usage: { input_tokens: 12, output_tokens: 8 },
    stopReason: 'tool_use',
  },
  {
    events: [
      { type: 'message_start', message: { usage: { input_tokens: 30 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Result: 42.' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      },
    ],
    finalContent: [{ type: 'text', text: 'Result: 42.' }],
    usage: { input_tokens: 30, output_tokens: 5 },
    stopReason: 'end_turn',
  },
];

let lookupCalls = 0;
const handler = createAnthropicHandler({
  client: fakeAnthropic(turns),
  model: 'claude-fake-smoke',
  tools: [
    {
      name: 'lookup',
      description: 'Fake lookup',
      input_schema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      execute: async ({ q }) => {
        lookupCalls++;
        return {
          output: { answer: 42, query: q },
          sources: [
            {
              id: 'src-1',
              type: 'knowledge',
              title: 'Knowledge doc',
              url: 'https://example.com/doc',
              snippet: 'Answer is 42',
            },
          ],
        };
      },
    },
  ],
});

// ---------- Exercise ----------

const events = [];
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

for await (const e of handler(input)) events.push(e);

console.log('Stream:');
for (const e of events)
  console.log(' ', e.type, JSON.stringify(e).slice(0, 100));

// ---------- Assertions ----------

const structural = validateEventStream(events);
const types = events.map(e => e.type);
const expectedTypes = [
  'message_start',
  'content_delta', // "Let me check. "      ← turn 1 stream
  'tool_call_start', // lookup(q=x)           ← turn 1 stream, mid-stream emit
  'content_delta', // "Looking now..."      ← turn 1 stream, AFTER tool_call_start
  'tool_call_end', // lookup result         ← after turn 1 stream + execution
  'content_delta', // "Result: 42."         ← turn 2 stream
  'sources', // accumulated from lookup's ToolResult.sources
  'content_end',
  'message_end',
];

const orderOk =
  expectedTypes.length === types.length &&
  expectedTypes.every((t, i) => types[i] === t);

const me = events[events.length - 1];
const expectedTotal = 12 + 8 + 30 + 5;
const tokensOk =
  me?.type === 'message_end' && me.tokenUsage?.totalTokens === expectedTotal;

const toolCallEnd = events.find(e => e.type === 'tool_call_end');
const toolCallStart = events.find(e => e.type === 'tool_call_start');
const toolOk =
  lookupCalls === 1 &&
  toolCallStart?.input?.q === 'x' &&
  toolCallEnd?.output?.answer === 42;

const sourcesEvent = events.find(e => e.type === 'sources');
const sourcesOk =
  sourcesEvent?.sources?.length === 1 &&
  sourcesEvent.sources[0].id === 'src-1' &&
  sourcesEvent.sources[0].type === 'knowledge' &&
  sourcesEvent.sources[0].url === 'https://example.com/doc';

// tool_call_start must land BETWEEN the two turn-1 content_deltas, not after
// the whole stream — this is the streaming-tool-inputs contract.
const startIdx = events.findIndex(e => e.type === 'tool_call_start');
const beforeStart = events[startIdx - 1];
const afterStart = events[startIdx + 1];
const streamingOk =
  beforeStart?.type === 'content_delta' &&
  beforeStart.delta === 'Let me check. ' &&
  afterStart?.type === 'content_delta' &&
  afterStart.delta === 'Looking now...';

console.log('\n--- assertions ---');
console.log(
  'structural:        ',
  structural.ok ? 'PASS' : `FAIL: ${structural.errors.join('; ')}`,
);
console.log(
  'event order:       ',
  orderOk
    ? 'PASS'
    : `FAIL\n   expected: ${expectedTypes.join(', ')}\n   got:      ${types.join(', ')}`,
);
console.log(
  'token aggregation: ',
  tokensOk
    ? 'PASS'
    : `FAIL (got ${me?.tokenUsage?.totalTokens}, expected ${expectedTotal})`,
);
console.log(
  'tool round-trip:   ',
  toolOk
    ? 'PASS'
    : `FAIL (calls=${lookupCalls}, input=${JSON.stringify(toolCallStart?.input)}, output=${JSON.stringify(toolCallEnd?.output)})`,
);
console.log(
  'sources batched:   ',
  sourcesOk ? 'PASS' : `FAIL (${JSON.stringify(sourcesEvent)})`,
);
console.log(
  'streamed mid-turn: ',
  streamingOk
    ? 'PASS'
    : `FAIL (before=${JSON.stringify(beforeStart)}, after=${JSON.stringify(afterStart)})`,
);

const allOk =
  structural.ok && orderOk && tokensOk && toolOk && sourcesOk && streamingOk;
console.log(allOk ? '\nall checks passed' : '\nSMOKE FAILED');
process.exit(allOk ? 0 : 1);
