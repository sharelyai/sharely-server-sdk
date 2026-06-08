import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@sharelyai/protocol';

import { validateEventStream, checkGolden } from '../src/validate.js';
import { allScenarios, scenarios } from '../src/scenarios.js';
import { referenceHandler, runHandlerConformance } from '../src/runner.js';

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

describe('validateEventStream — valid streams', () => {
  it('accepts a minimal text stream', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_delta', delta: 'hi' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    expect(validateEventStream(events)).toEqual({ ok: true, errors: [] });
  });

  it('accepts matched thinking and tool-call lifecycles', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'thinking_start', thinkingId: 't1', title: 'T' },
      { type: 'thinking_delta', thinkingId: 't1', delta: '...' },
      { type: 'thinking_end', thinkingId: 't1', status: 'completed', durationMs: 1 },
      { type: 'tool_call_start', toolCallId: 'c1', name: 'search', input: {} },
      { type: 'tool_call_end', toolCallId: 'c1', output: {}, durationMs: 1 },
      { type: 'content_delta', delta: 'done' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    expect(validateEventStream(events).ok).toBe(true);
  });

  // P0-4-bug regression: metadata_update is a valid AgentEvent (emitted by the
  // Vercel adapter) and must not be rejected as "not a known type".
  it('accepts a stream containing metadata_update', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'tool_call_start', toolCallId: 'c1', name: 'search', input: {} },
      { type: 'tool_call_end', toolCallId: 'c1', output: {}, durationMs: 1 },
      { type: 'metadata_update', metadata: { search: { hits: 3 } } },
      { type: 'content_delta', delta: 'ok' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    const result = validateEventStream(events);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a stream that ends with error (no message_end required)', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'error', error: 'boom' },
    ];
    expect(validateEventStream(events).ok).toBe(true);
  });

  it('accepts an empty stream as not-yet-terminated? no — requires terminator', () => {
    expect(validateEventStream([]).ok).toBe(false);
  });
});

describe('validateEventStream — invariant violations', () => {
  it('rejects an unknown event type', () => {
    const events = [{ type: 'nope' }] as unknown as AgentEvent[];
    const r = validateEventStream(events);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('not a known AgentEvent type'))).toBe(true);
  });

  it('rejects message_start that is not first', () => {
    const events: AgentEvent[] = [
      { type: 'content_delta', delta: 'x' },
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    const r = validateEventStream(events);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('message_start must be the first event'))).toBe(true);
  });

  it('rejects a duplicate message_start', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    expect(validateEventStream(events).errors.some(e => e.includes('duplicate message_start'))).toBe(true);
  });

  it('rejects a thinking_delta for an unopened id', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'thinking_delta', thinkingId: 'ghost', delta: 'x' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    expect(validateEventStream(events).errors.some(e => e.includes('unopened thinking'))).toBe(true);
  });

  it('rejects a tool_call_end for an unopened id', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'tool_call_end', toolCallId: 'ghost', output: {}, durationMs: 1 },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    expect(validateEventStream(events).errors.some(e => e.includes('unopened tool call'))).toBe(true);
  });

  it('reports thinking steps and tool calls that never close', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'thinking_start', thinkingId: 't1', title: 'T' },
      { type: 'tool_call_start', toolCallId: 'c1', name: 'search', input: {} },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    const r = validateEventStream(events);
    expect(r.errors.some(e => e.includes('thinking step "t1" never closed'))).toBe(true);
    expect(r.errors.some(e => e.includes('tool call "c1" never closed'))).toBe(true);
  });

  it('rejects content_delta after content_end and duplicate content_end', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_end' },
      { type: 'content_delta', delta: 'late' },
      { type: 'content_end' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
    ];
    const r = validateEventStream(events);
    expect(r.errors.some(e => e.includes('content_delta after content_end'))).toBe(true);
    expect(r.errors.some(e => e.includes('duplicate content_end'))).toBe(true);
  });

  it('rejects events after message_end', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'message_end', finishReason: 'stop', tokenUsage: usage },
      { type: 'content_delta', delta: 'too late' },
    ];
    expect(validateEventStream(events).errors.some(e => e.includes('appears after message_end'))).toBe(true);
  });

  it('rejects a stream with no terminator', () => {
    const events: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_delta', delta: 'x' },
    ];
    expect(validateEventStream(events).errors).toContain(
      'stream terminated without message_end or error',
    );
  });
});

describe('checkGolden', () => {
  it('passes for an identical stream', () => {
    expect(checkGolden(scenarios.textOnly.golden, scenarios.textOnly.golden).ok).toBe(true);
  });

  it('reports a count mismatch and a type mismatch', () => {
    const actual: AgentEvent[] = [
      { type: 'message_start', role: 'assistant', model: 'm' },
      { type: 'content_end' },
    ];
    const r = checkGolden(actual, scenarios.textOnly.golden);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('event count'))).toBe(true);
  });
});

describe('reference handler conformance over all scenarios', () => {
  it.each(allScenarios.map(s => [s.name, s] as const))(
    'scenario %s replays a conformant golden stream',
    async (_name, scenario) => {
      const report = await runHandlerConformance(referenceHandler(scenario), scenario);
      expect(report.structural.ok).toBe(true);
      expect(report.golden.ok).toBe(true);
      expect(report.ok).toBe(true);
    },
  );
});
