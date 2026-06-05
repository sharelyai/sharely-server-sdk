import type { Server } from 'node:http';

import { defaultLogger, type Logger } from './logger.js';

export interface GracefulShutdownOptions {
  /** Logger for shutdown messages. Defaults to the console logger. */
  logger?: Logger;
  /**
   * Max time to wait for in-flight connections (e.g. open SSE streams) to drain
   * before forcing exit. Defaults to 10s.
   */
  timeoutMs?: number;
  /** Signals that trigger shutdown. Defaults to SIGTERM + SIGINT. */
  signals?: NodeJS.Signals[];
  /** Optional cleanup run after the server stops accepting connections. */
  onShutdown?: () => void | Promise<void>;
}

/**
 * Install graceful-shutdown handlers on an `http.Server` (the value returned by
 * `app.listen(...)`). On SIGTERM/SIGINT it stops accepting new connections,
 * lets in-flight requests/SSE streams finish (bounded by `timeoutMs`), runs the
 * optional `onShutdown` hook, then exits.
 *
 * Returns a disposer that removes the signal listeners — useful in tests.
 */
export const installGracefulShutdown = (
  server: Server,
  options: GracefulShutdownOptions = {},
): (() => void) => {
  const logger = options.logger ?? defaultLogger;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully…`);

    const timer = setTimeout(() => {
      logger.warn(`Shutdown timed out after ${timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    server.close(err => {
      void (async () => {
        if (err) logger.error('Error during server close', err);
        try {
          await options.onShutdown?.();
        } catch (hookErr) {
          logger.error('onShutdown hook failed', hookErr);
        }
        clearTimeout(timer);
        logger.info('Shutdown complete');
        process.exit(err ? 1 : 0);
      })();
    });
  };

  const handlers = signals.map(sig => {
    const handler = (): void => shutdown(sig);
    process.on(sig, handler);
    return [sig, handler] as const;
  });

  return () => {
    for (const [sig, handler] of handlers) process.off(sig, handler);
  };
};
