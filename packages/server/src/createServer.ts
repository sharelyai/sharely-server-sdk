import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { Handler } from "@sharely/protocol";
import { createSharelyAPIClient, SharelyAPIError } from "@sharely/api";
import { extractAuthHeader, isInvalidBearer } from "./auth.js";
import { buildAgentContext } from "./context.js";
import { createFetcher, type FetcherError } from "./fetcher.js";
import { logger } from "./logger.js";
import { newId, runHandler } from "./pipeline.js";

export interface CreateSharelyServerOptions {
  apiUrl: string;
  workspaceId: string;
  /**
   * Workspace API key used by this server to (a) validate incoming user tokens
   * against `/v1/workspaces/:wsId/api-authenticated`, and (b) call the
   * Backplane (`storeMessage`, `getThread`, …). The incoming `Authorization`
   * header is the *token being validated*, not the auth used for platform
   * calls.
   */
  workspaceApiKey: string;
  handler: Handler | ((req: Request) => Handler | Promise<Handler>);
  allowedOrigins?: string | string[];
  rateLimitPerMinute?: number;
  bodyLimit?: string;
  fetcherTimeoutMs?: number;
  /**
   * Validate the incoming user token against the platform before invoking the
   * Handler. Defaults to `true`. Disable only for trusted test fixtures.
   */
  validateIncomingToken?: boolean;
}

const errorBody = (status: number, error: string, message: string) =>
  ({ error, message, status, timestamp: new Date().toISOString() });

const fail = (res: Response, status: number, error: string, message: string): void =>
  void res.status(status).json(errorBody(status, error, message));

export const createSharelyServer = (opts: CreateSharelyServerOptions): Express => {
  if (!opts.apiUrl) throw new Error("createSharelyServer: apiUrl is required");
  if (!opts.workspaceId) throw new Error("createSharelyServer: workspaceId is required");
  if (!opts.workspaceApiKey) throw new Error("createSharelyServer: workspaceApiKey is required");
  if (!opts.handler) throw new Error("createSharelyServer: handler is required");

  const fetcher = createFetcher({ baseUrl: opts.apiUrl, timeoutMs: opts.fetcherTimeoutMs });
  const platformAuth = opts.workspaceApiKey.startsWith("Bearer ")
    ? opts.workspaceApiKey
    : `Bearer ${opts.workspaceApiKey}`;
  const validateIncoming = opts.validateIncomingToken ?? true;
  const app = express();
  const bodyLimit = opts.bodyLimit ?? "10mb";

  app.use(cors({
    origin: opts.allowedOrigins, credentials: true, optionsSuccessStatus: 204,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "x-api-key"]
  }));
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  app.options("*", cors());

  const limiter = rateLimit({
    windowMs: 60_000, max: opts.rateLimitPerMinute ?? 20, standardHeaders: true,
    keyGenerator: req => extractAuthHeader(req.headers) ?? req.ip ?? "unknown",
    message: errorBody(429, "Rate Limit Exceeded", "You are sending messages too quickly. Please wait a moment.")
  });

  app.post("/agent/threads/:threadId/chat", limiter, async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const { message, languageId, topK, spaceId } = req.body ?? {};

    if (!threadId) return fail(res, 400, "Validation Error", "threadId is required");
    if (typeof message !== "string" || !message.trim())
      return fail(res, 400, "Validation Error", "message is required and must be a string");

    const authorization = extractAuthHeader(req.headers);
    if (!authorization) return fail(res, 401, "Authentication Error", "Authorization header is required");
    if (isInvalidBearer(authorization)) return fail(res, 401, "Authentication Error", "Invalid bearer token");

    let userId: string | undefined;
    let temporalUserId: string | undefined;
    let roleId: string | undefined;
    if (validateIncoming) {
      // /v1/workspaces/:wsId/api-authenticated requires admin-class auth
      // (workspaceApiKey) because it validates someone else's token. This
      // validator client is used ONLY for that one call.
      const validatorApi = createSharelyAPIClient({
        baseUrl: opts.apiUrl, workspaceId: opts.workspaceId, authorization: platformAuth
      });
      const token = authorization.replace(/^Bearer\s+/i, "").trim();
      try {
        const result = await validatorApi.tokens.validate(token);
        if (!result || (!result.id && !result.temporalUserId)) {
          return fail(res, 401, "Authentication Error", "Token rejected by platform");
        }
        userId = result.id;
        temporalUserId = result.temporalUserId;
        roleId = result.user_metadata?.roleId ?? result.user_metadata?.customerRoleId;
      } catch (err) {
        const status = err instanceof SharelyAPIError ? err.status : 401;
        logger.warn("token validation failed", err instanceof Error ? err.message : err);
        return fail(res, status === 401 || status === 403 ? status : 401,
          "Authentication Error", "Token rejected by platform");
      }
    }

    // Backplane persistence / RAG / AgentContext.api use the incoming user
    // token so the platform's RBAC checks (`getTokenRoleId` against
    // `agentThread.roleId`) operate against the real user — not the workspace
    // admin key. workspaceApiKey is reserved for `tokens.validate` above.
    const api = createSharelyAPIClient({
      baseUrl: opts.apiUrl, workspaceId: opts.workspaceId, authorization,
      ...(roleId !== undefined && { roleId })
    });

    const context = buildAgentContext({
      workspaceId: opts.workspaceId, threadId, authorization,
      apiBaseUrl: opts.apiUrl, traceId: newId(), messageId: newId(),
      apiClient: api,
      ...(userId && { userId }),
      ...(temporalUserId && { temporalUserId }),
      ...(roleId !== undefined && { roleId }),
      ...(typeof spaceId === "string" && { spaceId }),
      ...(typeof languageId === "string" && { languageId }),
      ...(typeof topK === "number" && { topK })
    });

    const handler =
      typeof opts.handler === "function" && opts.handler.length === 1
        ? await (opts.handler as (r: Request) => Handler | Promise<Handler>)(req)
        : (opts.handler as Handler);

    try {
      await runHandler({ handler, context, message: message.trim(), res, api });
    } catch (err) {
      logger.error("chat handler crashed", err);
      if (!res.headersSent) {
        fail(res, 500, "Internal Server Error", err instanceof Error ? err.message : "Unexpected error");
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.get("/goals/spaces/:spaceId", async (req: Request, res: Response) => {
    const authorization = extractAuthHeader(req.headers);
    try {
      const upstream = await fetcher({
        url: `/goals/spaces/${encodeURIComponent(req.params.spaceId)}`,
        ...(authorization && { headers: { authorization } })
      });
      res.status(upstream.status).json(upstream.data);
    } catch {
      res.status(404).json({ message: "No goals found", status: 404, timestamp: new Date().toISOString() });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ message: "Sharely server is running", workspaceId: opts.workspaceId, timestamp: new Date().toISOString() });
  });

  app.all("*", async (req: Request, res: Response) => {
    logger.debug(`Proxying ${req.method} ${req.url}`);
    try {
      const upstream = await fetcher({
        url: req.url,
        method: req.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
        body: req.body,
        headers: req.headers as Record<string, string | string[] | undefined>
      });
      res.status(upstream.status).json(upstream.data);
    } catch (err) {
      const e = err as Partial<FetcherError> & { status?: number };
      const status = e.status ?? 500;
      logger.error("proxy error", { method: req.method, url: req.url, status, message: e.message });
      res.status(status).json(errorBody(status, e.error ?? "Request Error", e.message ?? "Upstream request failed"));
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as Partial<FetcherError> & { status?: number };
    logger.error("server error", e?.message ?? err);
    const status = e.status ?? 500;
    res.status(status).json(errorBody(status, e.error ?? "Internal Server Error", e.message ?? "Unexpected error"));
  });

  return app;
};
