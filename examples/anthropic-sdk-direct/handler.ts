// Pattern C — raw Sharely `Handler` driving @anthropic-ai/sdk directly.
//
// Copy this into your project. You will need:
//   npm i @anthropic-ai/sdk @sharely/protocol
//
// The handler streams text + thinking deltas live, buffers tool blocks until
// the assistant turn finishes, then replays them as `tool_call_start` /
// `tool_call_end` (with the full parsed input) and feeds tool results back to
// Anthropic for the next iteration. `input.signal` propagates to the upstream
// stream so client disconnects abort the in-flight HTTP request.

import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentEvent,
  AgentInput,
  Handler,
  Source,
  ToolResult,
} from '@sharelyai/protocol';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
  /**
   * Returns the Sharely `ToolResult` shape: `output` is JSON-fed back to
   * Anthropic, `sources` are accumulated and emitted as a single batched
   * `sources` event before `content_end`.
   */
  execute: (input: unknown) => Promise<ToolResult>;
}

export interface AnthropicHandlerOptions {
  client: Anthropic;
  model: string;
  systemPrompt?: string;
  tools?: ToolDef[];
  maxIterations?: number;
  maxTokens?: number;
}

type Msg = { role: 'user' | 'assistant'; content: unknown };

export const createAnthropicHandler = (
  opts: AnthropicHandlerOptions,
): Handler => {
  const {
    client,
    model,
    systemPrompt,
    tools = [],
    maxIterations = 10,
    maxTokens = 4096,
  } = opts;

  const toolMap = new Map(tools.map(t => [t.name, t]));
  const apiTools =
    tools.length > 0
      ? tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        }))
      : undefined;

  return async function* (input: AgentInput): AsyncIterable<AgentEvent> {
    const messages: Msg[] = [
      ...input.history.map(m => ({ role: m.role, content: m.content ?? '' })),
      { role: 'user', content: input.message },
    ];

    yield { type: 'message_start', role: 'assistant', model };

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'stop';
    const collectedSources: Source[] = [];

    for (let i = 0; i < maxIterations; i++) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(apiTools ? { tools: apiTools } : {}),
          messages: messages as Anthropic.MessageParam[],
        },
        { signal: input.signal },
      );

      const openThinking = new Map<number, string>();
      const openToolUse = new Map<
        number,
        { id: string; name: string; inputJson: string }
      >();

      for await (const event of stream) {
        if (input.signal.aborted) return;

        switch (event.type) {
          case 'message_start':
            inputTokens += event.message.usage?.input_tokens ?? 0;
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
              let parsedInput: Record<string, unknown> = {};
              if (tu.inputJson) {
                try {
                  parsedInput = JSON.parse(tu.inputJson) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  // Leave as {} — Anthropic shouldn't emit malformed JSON, but
                  // don't crash the stream if it does. The post-stream
                  // execution step uses the SDK's canonical parse anyway.
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
            if (event.delta.stop_reason) finishReason = event.delta.stop_reason;
            outputTokens += event.usage?.output_tokens ?? 0;
            break;
        }
      }

      const final = await stream.finalMessage();
      messages.push({ role: 'assistant', content: final.content });

      const toolUses = final.content.filter(
        (b: any): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (toolUses.length === 0) break;

      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
        is_error?: true;
      }> = [];

      for (const tu of toolUses) {
        const t = toolMap.get(tu.name);
        const started = Date.now();
        // tool_call_start was already yielded during the stream (at the
        // tool_use block_stop) with the input parsed from input_json_delta.
        // This step only executes the tool and yields tool_call_end.

        let output: unknown;
        let error: string | undefined;
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
