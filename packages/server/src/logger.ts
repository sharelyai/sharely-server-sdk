/**
 * Minimal structured logger interface. Customers can pass their own
 * implementation (pino, winston, a no-op, …) via
 * `createSharelyServer({ logger })`; if omitted, {@link defaultLogger} is used.
 *
 * Each method receives a human-readable message plus arbitrary structured
 * arguments — implementations are free to ignore the extra args.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const DEBUG = process.env["DEBUG"] === "true";

/**
 * Default console-backed logger. `debug` is gated on `DEBUG=true`; the other
 * levels always emit. Kept as the zero-config default so existing behaviour is
 * unchanged when no `logger` is supplied.
 */
export const defaultLogger: Logger = {
  debug: (message, ...args): void => {
    if (DEBUG) console.log("[DEBUG]", message, ...args);
  },
  info: (message, ...args): void => {
    console.log("[INFO]", message, ...args);
  },
  warn: (message, ...args): void => {
    console.warn("[WARN]", message, ...args);
  },
  error: (message, ...args): void => {
    console.error("[ERROR]", message, ...args);
  },
};

/**
 * Backwards-compatible module-level logger. Prefer threading a {@link Logger}
 * through `createSharelyServer({ logger })` instead of importing this directly.
 */
export const logger: Logger = defaultLogger;
