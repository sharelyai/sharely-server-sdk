import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createSharelyAPIClient, SharelyAPIError } from '@sharelyai/api';

import { extractAuthHeader, isInvalidBearer } from './auth.js';
import { buildAgentContext } from './context.js';
import { createFetcher, type FetcherError } from './fetcher.js';
import { logger } from './logger.js';
import { newId, runHandler } from './pipeline.js';

// types
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Handler } from '@sharelyai/protocol';

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

const errorBody = (status: number, error: string, message: string) => ({
  error,
  message,
  status,
  timestamp: new Date().toISOString(),
});

const fail = (
  res: Response,
  status: number,
  error: string,
  message: string,
): void => void res.status(status).json(errorBody(status, error, message));

export const createSharelyServer = (
  opts: CreateSharelyServerOptions,
): Express => {
  if (!opts.apiUrl) throw new Error('createSharelyServer: apiUrl is required');
  if (!opts.workspaceId)
    throw new Error('createSharelyServer: workspaceId is required');
  if (!opts.workspaceApiKey)
    throw new Error('createSharelyServer: workspaceApiKey is required');
  if (!opts.handler)
    throw new Error('createSharelyServer: handler is required');

  const fetcher = createFetcher({
    baseUrl: opts.apiUrl,
    timeoutMs: opts.fetcherTimeoutMs,
  });

  // `workspaceApiKey` is the raw `sk-sharely-*` key issued from the workspace
  // settings. The Backplane middleware (`isApiKeyAuthenticated`) only accepts
  // the *exchanged* access JWT, so we lazily POST it through
  // `/workspaces/:wsId/generate-access-key-token` on first chat request and
  // cache the resulting JWT. The cached promise is cleared on failure so the
  // next request retries.
  const apiUrlRoot = opts.apiUrl.replace(/\/$/, '');

  // `workspaceApiKey` is the raw `sk-sharely-*` key. The Backplane middleware
  // only accepts the *exchanged* access JWT, and on RBAC-enabled workspaces
  // that JWT must embed the acting user's role (`user_metadata.roleId`) or
  // Backplane writes 400 with "A roleId is required …". So we exchange
  // per-role and cache by role. The role-less exchange (key `__norole__`) is
  // used only to call `/api-authenticated` (which doesn't need a role).
  type RoleClaim = { roleId?: string; customerRoleId?: string };
  const NO_ROLE = '__norole__';
  const platformAuthByRole = new Map<string, Promise<string>>();
  const resolvePlatformAuth = (role?: RoleClaim): Promise<string> => {
    const cacheKey = role?.roleId ?? role?.customerRoleId ?? NO_ROLE;
    const cached = platformAuthByRole.get(cacheKey);
    if (cached) return cached;

    const p = (async () => {
      try {
        const rawKey = opts.workspaceApiKey.replace(/^Bearer\s+/i, '').trim();
        const url = `${apiUrlRoot}/workspaces/${encodeURIComponent(opts.workspaceId)}/generate-access-key-token`;
        const body: RoleClaim = {};
        if (role?.roleId) body.roleId = role.roleId;
        else if (role?.customerRoleId) body.customerRoleId = role.customerRoleId;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': rawKey,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `generate-access-key-token failed: ${res.status} ${res.statusText} ${text}`,
          );
        }
        const data = (await res.json()) as { token?: string };
        if (!data?.token) {
          throw new Error('generate-access-key-token returned no token');
        }
        logger.info('exchanged sk-sharely-* for access JWT', {
          role: cacheKey,
        });
        return `Bearer ${data.token}`;
      } catch (err) {
        platformAuthByRole.delete(cacheKey);
        throw err;
      }
    })();
    platformAuthByRole.set(cacheKey, p);
    return p;
  };

  const validateIncoming = opts.validateIncomingToken ?? true;
  const app = express();
  const bodyLimit = opts.bodyLimit ?? '10mb';

  app.use(
    cors({
      origin: opts.allowedOrigins,
      credentials: true,
      optionsSuccessStatus: 204,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'x-api-key',
      ],
    }),
  );
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  app.options('*', cors());

  const limiter = rateLimit({
    windowMs: 60_000,
    max: opts.rateLimitPerMinute ?? 20,
    standardHeaders: true,
    keyGenerator: req => extractAuthHeader(req.headers) ?? req.ip ?? 'unknown',
    message: errorBody(
      429,
      'Rate Limit Exceeded',
      'You are sending messages too quickly. Please wait a moment.',
    ),
  });

  app.post(
    '/agent/threads/:threadId/chat',
    limiter,
    async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message, languageId, topK, spaceId } = req.body ?? {};

      if (!threadId)
        return fail(res, 400, 'Validation Error', 'threadId is required');
      if (typeof message !== 'string' || !message.trim())
        return fail(
          res,
          400,
          'Validation Error',
          'message is required and must be a string',
        );

      const authorization = extractAuthHeader(req.headers);
      if (!authorization)
        return fail(
          res,
          401,
          'Authentication Error',
          'Authorization header is required',
        );
      if (isInvalidBearer(authorization))
        return fail(res, 401, 'Authentication Error', 'Invalid bearer token');

      // Step 1: a role-less access JWT, used only to validate the incoming
      // user token via /api-authenticated (that endpoint needs admin-class
      // auth but no role).
      let baseAuth: string;
      try {
        baseAuth = await resolvePlatformAuth();
      } catch (err) {
        logger.error(
          'failed to exchange sk-sharely-* for access JWT',
          err instanceof Error ? err.message : err,
        );
        return fail(
          res,
          500,
          'Internal Server Error',
          'Could not exchange workspace API key for an access token',
        );
      }

      let userId: string | undefined;
      let temporalUserId: string | undefined;
      let roleId: string | undefined;
      let customerRoleId: string | undefined;
      if (validateIncoming) {
        const validatorApi = createSharelyAPIClient({
          baseUrl: opts.apiUrl,
          workspaceId: opts.workspaceId,
          authorization: baseAuth,
        });
        const token = authorization.replace(/^Bearer\s+/i, '').trim();
        try {
          const result = await validatorApi.tokens.validate(token);
          if (!result || (!result.id && !result.temporalUserId)) {
            return fail(
              res,
              401,
              'Authentication Error',
              'Token rejected by platform',
            );
          }
          userId = result.id;
          temporalUserId = result.temporalUserId;
          roleId = result.user_metadata?.roleId;
          customerRoleId = result.user_metadata?.customerRoleId;
        } catch (err) {
          const status = err instanceof SharelyAPIError ? err.status : 401;
          logger.warn(
            'token validation failed',
            err instanceof Error ? err.message : err,
          );
          return fail(
            res,
            status === 401 || status === 403 ? status : 401,
            'Authentication Error',
            'Token rejected by platform',
          );
        }
      }

      // Step 2: exchange again *with the user's role* so the access JWT used
      // for Backplane carries `user_metadata.roleId`. RBAC-enabled workspaces
      // reject role-less tokens on writes (getTokenRoleId). Falls back to the
      // role-less token when the user has no role (non-RBAC workspaces).
      let platformAuth = baseAuth;
      if (roleId || customerRoleId) {
        try {
          platformAuth = await resolvePlatformAuth({
            ...(roleId && { roleId }),
            ...(customerRoleId && { customerRoleId }),
          });
        } catch (err) {
          logger.error(
            'failed to exchange role-scoped access JWT',
            err instanceof Error ? err.message : err,
          );
          return fail(
            res,
            500,
            'Internal Server Error',
            'Could not exchange workspace API key for a role-scoped access token',
          );
        }
      }

      // Backplane persistence / tool dispatch / AgentContext.api use the
      // role-scoped access JWT so sharelyai-be's RBAC (getTokenRoleId against
      // the token + agentThread.roleId) operates as the real user. The
      // resolved role UUID is also surfaced via `roleId` for tool-dispatch
      // bodies.
      const api = createSharelyAPIClient({
        baseUrl: opts.apiUrl,
        workspaceId: opts.workspaceId,
        authorization: platformAuth,
        ...(roleId !== undefined && { roleId }),
      });

      // `X-Sharely-Message-Id` is set by sharelyai-be's proxyToAgentServer:
      // it's the trace messageId for which sharelyai-be has already pre-
      // created an empty assistant AgentMessage row. Using it as our trace
      // messageId means the SSE envelope, AgentLog correlation, and the id
      // we pass to Backplane storeMessage all align with that single row.
      const proxiedMessageIdHeader = req.headers['x-sharely-message-id'];
      const proxiedMessageId = Array.isArray(proxiedMessageIdHeader)
        ? proxiedMessageIdHeader[0]
        : proxiedMessageIdHeader;
      const assistantMessageId =
        typeof proxiedMessageId === 'string' && proxiedMessageId.trim()
          ? proxiedMessageId.trim()
          : newId();

      const context = buildAgentContext({
        workspaceId: opts.workspaceId,
        threadId,
        authorization,
        apiBaseUrl: opts.apiUrl,
        traceId: newId(),
        messageId: assistantMessageId,
        apiClient: api,
        ...(userId && { userId }),
        ...(temporalUserId && { temporalUserId }),
        ...(roleId !== undefined && { roleId }),
        ...(typeof spaceId === 'string' && { spaceId }),
        ...(typeof languageId === 'string' && { languageId }),
        ...(typeof topK === 'number' && { topK }),
      });

      // `opts.handler` can be a Handler (`async function*(input)`) OR a
      // per-request factory (`(req) => Handler`). Both have arity 1, so we
      // can't differentiate by `.length`. Async generator functions have a
      // dedicated constructor name; anything else is treated as a factory.
      const isAsyncGenFn = (fn: unknown): boolean =>
        typeof fn === 'function' &&
        (fn as { constructor?: { name?: string } }).constructor?.name ===
          'AsyncGeneratorFunction';

      const handler = isAsyncGenFn(opts.handler)
        ? (opts.handler as Handler)
        : await (opts.handler as (r: Request) => Handler | Promise<Handler>)(
            req,
          );

      try {
        await runHandler({
          handler,
          context,
          message: message.trim(),
          res,
          api,
        });
      } catch (err) {
        logger.error('chat handler crashed', err);
        if (!res.headersSent) {
          fail(
            res,
            500,
            'Internal Server Error',
            err instanceof Error ? err.message : 'Unexpected error',
          );
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    },
  );

  app.get('/goals/spaces/:spaceId', async (req: Request, res: Response) => {
    const authorization = extractAuthHeader(req.headers);
    try {
      const upstream = await fetcher({
        url: `/goals/spaces/${encodeURIComponent(req.params.spaceId)}`,
        ...(authorization && { headers: { authorization } }),
      });
      res.status(upstream.status).json(upstream.data);
    } catch {
      res.status(404).json({
        message: 'No goals found',
        status: 404,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      message: 'Sharely server is running',
      workspaceId: opts.workspaceId,
      timestamp: new Date().toISOString(),
    });
  });

  app.all('*', async (req: Request, res: Response) => {
    logger.debug(`Proxying ${req.method} ${req.url}`);
    try {
      const upstream = await fetcher({
        url: req.url,
        method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        body: req.body,
        headers: req.headers as Record<string, string | string[] | undefined>,
      });
      res.status(upstream.status).json(upstream.data);
    } catch (err) {
      const e = err as Partial<FetcherError> & { status?: number };
      const status = e.status ?? 500;
      logger.error('proxy error', {
        method: req.method,
        url: req.url,
        status,
        message: e.message,
      });
      res
        .status(status)
        .json(
          errorBody(
            status,
            e.error ?? 'Request Error',
            e.message ?? 'Upstream request failed',
          ),
        );
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as Partial<FetcherError> & { status?: number };
    logger.error('server error', e?.message ?? err);
    const status = e.status ?? 500;
    res
      .status(status)
      .json(
        errorBody(
          status,
          e.error ?? 'Internal Server Error',
          e.message ?? 'Unexpected error',
        ),
      );
  });

  return app;
};
