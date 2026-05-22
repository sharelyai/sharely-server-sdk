export interface TransportRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TransportResponse<T = unknown> { data: T; status: number; }

export type Transport = <T = unknown>(req: TransportRequest) => Promise<TransportResponse<T>>;

export class SharelyAPIError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "SharelyAPIError";
    this.status = status;
    this.data = data;
  }
}

export const defaultTransport = (baseUrl: string, timeoutMs = 30_000): Transport => {
  const root = baseUrl.replace(/\/$/, "");
  return async <T>(req: TransportRequest): Promise<TransportResponse<T>> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("Request timeout")), timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, ctrl.signal]) : ctrl.signal;
    try {
      const res = await fetch(`${root}${req.url}`, {
        method: req.method,
        headers: {
          Accept: "application/json",
          ...(req.body !== undefined && { "Content-Type": "application/json" }),
          ...req.headers
        },
        body: req.body !== undefined
          ? typeof req.body === "string" ? req.body : JSON.stringify(req.body)
          : undefined,
        signal
      });
      const ct = res.headers.get("content-type") ?? "";
      const data = (ct.includes("application/json") ? await res.json() : await res.text()) as T;
      if (!res.ok) {
        const msg = (data && typeof data === "object" && "message" in (data as object)
          ? String((data as { message?: unknown }).message) : undefined) ?? res.statusText;
        throw new SharelyAPIError(msg, res.status, data);
      }
      return { data, status: res.status };
    } finally { clearTimeout(timer); }
  };
};
