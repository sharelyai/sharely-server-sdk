const DEBUG = process.env["DEBUG"] === "true";

export const logger = {
  debug: (...args: unknown[]): void => {
    if (DEBUG) console.log("[DEBUG]", ...args);
  },
  info: (...args: unknown[]): void => {
    console.log("[INFO]", ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn("[WARN]", ...args);
  },
  error: (...args: unknown[]): void => {
    console.error("[ERROR]", ...args);
  }
};
