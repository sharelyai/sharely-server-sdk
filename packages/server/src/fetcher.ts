import { defaultLogger, type Logger } from "./logger.js";

export interface FetcherOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  signal?: AbortSignal;
}
export interface FetcherResponse<T = unknown> { data: T; status: number; }
export interface FetcherError {
  error: string; message: string; status: number; data?: unknown; timestamp: string;
}

const DROPPED = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "accept-encoding", "accept-language",
  "upgrade", "content-length", "host", "origin", "referer", "if-none-match", "dnt"
]);

const sanitize = (
  raw: Record<string, string | string[] | undefined>,
  method: string
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    out["Accept"] = "application/json";
    out["Content-Type"] = "application/json";
  }
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (DROPPED.has(lower)) continue;
    if (lower.startsWith("sec-ch-") || lower.startsWith("sec-fetch-")) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string" && v.trim()) out[name] = v;
  }
  return out;
};

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const backoffMs = (attempt: number) => Math.min(2 ** attempt * 250, 4000);
const fail = (message: string, status: number, data?: unknown): FetcherError =>
  ({ error: "RemoteRequestFailed", message, status, data, timestamp: new Date().toISOString() });

export interface FetcherConfig { baseUrl: string; timeoutMs?: number; retries?: number; logger?: Logger; }

export const createFetcher = (config: FetcherConfig) => {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;
  const retries = config.retries ?? 3;
  const logger = config.logger ?? defaultLogger;

  return async <T = unknown>(opts: FetcherOptions): Promise<FetcherResponse<T>> => {
    const method = opts.method ?? "GET";
    const headers = sanitize(opts.headers ?? {}, method);
    const url = `${baseUrl}${opts.url}`;
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body = hasBody && opts.body !== undefined
      ? typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)
      : undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(new Error("Request timeout")), timeoutMs);
      const signal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal;

      try {
        const res = await fetch(url, { method, headers, body, signal });
        clearTimeout(timer);
        const ct = res.headers.get("content-type") ?? "";
        const data = (ct.includes("application/json")
          ? await res.json()
          : await res.text()) as T;

        if (res.ok) return { data, status: res.status };
        if (res.status >= 500 && attempt < retries) {
          logger.debug(`Retry ${attempt + 1}/${retries} (${res.status}) ${method} ${url}`);
          await wait(backoffMs(attempt));
          continue;
        }

        const msg = (data && typeof data === "object" && "message" in (data as object)
          ? String((data as { message?: unknown }).message)
          : undefined) ?? res.statusText;
        throw fail(msg, res.status, data);
      } catch (err) {
        clearTimeout(timer);
        if (opts.signal?.aborted) throw err;
        if (err && typeof err === "object" && "status" in err) throw err;
        if (attempt >= retries) throw fail(err instanceof Error ? err.message : "Request failed", 500);
        logger.debug(`Retry ${attempt + 1}/${retries} (network) ${method} ${url}`);
        await wait(backoffMs(attempt));
      }
    }
    throw new Error("unreachable");
  };
};

export type Fetcher = ReturnType<typeof createFetcher>;
