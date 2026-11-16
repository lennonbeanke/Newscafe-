// The HTTP application (Hono). Built from injected parts so tests can run it without opening a port.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { PublicConfig } from './config.ts';
import type { Db } from './db.ts';
import { failure, mapDbFailure, sqlstateOf } from './errors.ts';
import type { HttpFailure } from './errors.ts';
import type { Logger } from './logger.ts';
import { RateLimiter } from './rate-limit.ts';
import { AvailabilityBody, AvailabilityQuery, ErrorBody, HealthBody, IdempotencyHeader, ReservationBody, ReservationCreated } from './schemas.ts';
import type { Services } from './services.ts';

export interface AppEnv { Variables: { requestId: string } }

export interface Deps {
  config: PublicConfig;
  db: Db;
  services: Services;
  logger: Logger;
  limiter?: RateLimiter;
  /** Identifies the caller for rate limiting. Default: keyed hash of the connection's address (never X-Forwarded-For). */
  clientId?: (c: Context) => string;
}

const KNOWN: Readonly<Record<string, readonly string[]>> = {
  '/api/health': ['GET'],
  '/api/availability': ['GET'],
  '/api/reservations': ['POST'],
};

export function buildPublicApp(deps: Deps) {
  const { config, services, logger } = deps;
  const limiter = deps.limiter ?? new RateLimiter();
  // The rate-limit key is a hash of the connection address under a random key that exists only in this process's memory
  // (the public process holds no configured secret at all).
  const clientKey = randomBytes(32);
  const clientId = deps.clientId ?? ((c: Context): string => {
    const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? 'unknown';
    return createHmac('sha256', clientKey).update(addr).digest('hex').slice(0, 16);
  });
  const rid = (c: Context<AppEnv>): string => c.get('requestId');
  const reply = (c: Context<AppEnv>, f: HttpFailure): Response => c.json({ ...f.body, request_id: rid(c) }, f.status);

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        // Report WHERE the problem is, never what the client sent.
        const issues = result.error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.') || '(body)', code: i.code }));
        return c.json({ ...failure('validation_failed', 422).body, request_id: rid(c), issues }, 422);
      }
      return undefined;
    },
  });

  // ---- cross-cutting middleware ------------------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    const started = performance.now();
    const id = randomUUID();                       // never taken from the client (no log injection)
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.header('Cross-Origin-Resource-Policy', 'same-site');
    await next();
    const matched = c.req.matchedRoutes.at(-1)?.path ?? '*';
    logger.info('request', {
      request_id: id, method: c.req.method,
      route: matched === '*' || matched === '/*' ? '(unmatched)' : matched,   // the route pattern, never the raw URL
      status: c.res.status, duration_ms: Math.round(performance.now() - started),
    });
  });

  app.use('/api/*', cors({
    origin: config.allowedOrigin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key'],
    maxAge: 600,
    credentials: false,
  }));

  const requireJson: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.method === 'POST' && !/^application\/json(\s*;.*)?$/i.test(c.req.header('content-type') ?? '')) {
      return reply(c, failure('unsupported_media_type', 415));
    }
    await next();
  };
  const limitBody: MiddlewareHandler<AppEnv> = bodyLimit({
    maxSize: config.tuning.bodyLimitBytes,
    onError: (c) => reply(c as Context<AppEnv>, failure('payload_too_large', 413)),
  });
  const rateLimit = (name: string, limit: number, windowMs: number): MiddlewareHandler<AppEnv> => async (c, next) => {
    const r = limiter.hit(`${name}:${clientId(c)}`, limit, windowMs);
    if (!r.allowed) {
      c.header('Retry-After', String(r.retryAfterSec));
      return reply(c, failure('rate_limited', 429));
    }
    await next();
  };

  const fail = (c: Context<AppEnv>, err: unknown): Response => {
    const f = mapDbFailure(err, config);
    const state = sqlstateOf(err);
    const fields = { request_id: rid(c), code: state ?? f.logCode, error_class: err instanceof Error ? err.name : 'unknown', outcome: f.logCode };
    if (f.status >= 500 && f.logCode === 'internal_error') logger.error('request_failed', fields); else logger.warn('request_failed', fields);
    return reply(c, f);
  };

  const failureResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorBody } } });

  // ---- GET /api/health ----------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get', path: '/api/health', tags: ['Public'], summary: 'Is online booking usable right now?',
      description: 'Answers from a short cache; the database is only touched when this is called and the cached answer is old. '
        + 'Never returns internal details. `request_only` means the website should offer "request a booking" instead of live booking.',
      responses: { 200: { description: 'The API is up.', content: { 'application/json': { schema: HealthBody } } } },
    }),
    async (c) => c.json({ status: 'ok' as const, booking: ((await services.bookingAvailable()) ? 'available' : 'request_only') as 'available' | 'request_only' }, 200),
  );

  // ---- GET /api/availability ----------------------------------------------------------------------------------------
  app.use('/api/availability', rateLimit('availability', 60, 60_000));
  app.openapi(
    createRoute({
      method: 'get', path: '/api/availability', tags: ['Public'], summary: 'Bookable start times for a date and party size',
      description: 'Only times are returned (never tables or counts). The booking itself re-checks everything.',
      request: { query: AvailabilityQuery },
      responses: {
        200: { description: 'Slots (possibly none).', content: { 'application/json': { schema: AvailabilityBody } } },
        422: failureResponse('Invalid date/party, party not allowed, or date outside the booking window.'),
        429: failureResponse('Rate limited.'),
        500: failureResponse('Unexpected error.'),
        503: failureResponse('Booking rules not configured, or the database is unavailable (`fallback: "request"`).'),
      },
    }),
    async (c) => {
      const { date, party } = c.req.valid('query');
      try {
        const { slots } = await services.slots(date, party);
        return c.json({ date, party, slots }, 200);
      } catch (err) { return fail(c, err) as never; }
    },
  );

  // ---- POST /api/reservations ---------------------------------------------------------------------------------------
  app.use('/api/reservations', requireJson, limitBody, rateLimit('reservations', 10, 600_000));
  app.openapi(
    createRoute({
      method: 'post', path: '/api/reservations', tags: ['Public'], summary: 'Request a table',
      description: 'Creates a booking in the database. `201` means it is saved (status `pending` until the owner confirms, unless the owner enabled auto-confirm). '
        + 'Send the same `Idempotency-Key` when retrying: a repeat of the same request returns the same booking, never a second one. '
        + 'If the database cannot be reached the answer is `503` with `fallback: "request"`; a booking is never reported as saved unless it was committed.',
      request: {
        headers: IdempotencyHeader,
        body: { required: true, content: { 'application/json': { schema: ReservationBody } } },
      },
      responses: {
        201: { description: 'Saved.', content: { 'application/json': { schema: ReservationCreated } } },
        409: failureResponse('No table available (nearby `alternatives` when known) or the idempotency key was used for a different request.'),
        413: failureResponse('Body larger than 16 KB.'),
        415: failureResponse('Not application/json.'),
        422: failureResponse('Validation failed or a booking rule was not met.'),
        429: failureResponse('Rate limited.'),
        500: failureResponse('Unexpected error.'),
        503: failureResponse('Booking unavailable (`fallback: "request"`), not configured, or outcome unknown (retry with the same key).'),
      },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const key = c.req.valid('header')['idempotency-key'];
      try {
        const created = await services.book({
          partySize: b.party_size, startsAt: b.starts_at, name: b.name,
          email: b.email, phone: b.phone, notes: b.notes, idempotencyKey: key,
        });
        return c.json(created, 201);
      } catch (err) {
        const f = mapDbFailure(err, config);
        if (f.logCode === 'no_availability') {
          const alternatives = await services.alternatives(b.starts_at, b.party_size);
          if (alternatives.length > 0) { fail(c, err); return reply(c, { ...f, body: { ...f.body, alternatives } }) as never; }
        }
        return fail(c, err) as never;
      }
    },
  );

  // ---- everything else ------------------------------------------------------------------------------------------------
  app.notFound((c) => {
    const allowed = KNOWN[new URL(c.req.url).pathname];
    if (allowed) { c.header('Allow', [...allowed, 'OPTIONS'].join(', ')); return reply(c, failure('method_not_allowed', 405)); }
    return reply(c, failure('not_found', 404));
  });
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const f = err.status === 400 ? failure('malformed_json', 400) : err.status === 413 ? failure('payload_too_large', 413) : failure('internal_error', 500);
      return reply(c, f);
    }
    logger.error('unhandled_error', { request_id: rid(c), error_class: err instanceof Error ? err.name : 'unknown' });
    return reply(c, failure('internal_error', 500));
  });

  return app;
}
