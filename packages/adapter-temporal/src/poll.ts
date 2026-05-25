import type { AgentEvent, AgentInput, Handler } from '@sharelyai/protocol';
import type { AgentEventSource } from './types.js';

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Generic pull-to-stream Handler: polls an `AgentEventSource` until it reports
 * `done`, yielding events as they arrive. On `input.signal` abort it cancels
 * the source and stops. Framework-agnostic and unit-testable with a fake
 * source — `fromTemporal` is a thin binding over this.
 */
export const pollingHandler = (
  createSource: (
    input: AgentInput,
  ) => AgentEventSource | Promise<AgentEventSource>,
  pollIntervalMs = 250,
): Handler =>
  async function* (input): AsyncIterable<AgentEvent> {
    let source: AgentEventSource;
    try {
      source = await createSource(input);
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : 'failed to start workflow',
      };
      return;
    }

    let cursor = 0;
    try {
      while (true) {
        if (input.signal.aborted) {
          await source.cancel().catch(() => {});
          return;
        }
        const page = await source.poll(cursor);
        cursor = page.cursor ?? cursor + page.events.length;
        for (const event of page.events) {
          if (input.signal.aborted) {
            await source.cancel().catch(() => {});
            return;
          }
          yield event;
        }
        if (page.done) return;
        if (page.events.length === 0) await delay(pollIntervalMs, input.signal);
      }
    } catch (err) {
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : 'workflow poll failed',
      };
    }
  };
