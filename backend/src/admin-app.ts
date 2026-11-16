// The OWNER (admin) HTTP application. A separate process from the public API, holding only the admin database login.
// Security model:
//   * default-deny: every route registers its own guard; nothing here is reachable without a valid session except POST /login
//   * password (Argon2id) -> full session. There is NO second factor: the owner chose email + password only (see docs/SECURITY.md)
//   * sessions: random 256-bit token in an HttpOnly SameSite=Strict cookie; only its SHA-256 hash is stored; idle + absolute expiry;
//               server-side revocation; a fresh token is issued at every sign-in (no session fixation)
//   * lockout: 5 consecutive wrong passwords lock the account for 15 minutes; every failure answers identically
//   * CSRF: unsafe requests need the dashboard's exact Origin, the X-Requested-With header AND a per-session CSRF token
//   * every reservation change goes through an admin_* database function: actor + audit row in the same transaction
import { createHmac, randomUUID } from 'node:crypto';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { AdminConfig } from './config.ts';
import type { Db, Queryable } from './db.ts';
import { DbEnvironmentRefused, DbOutcomeUnknown, DbUnavailable, sqlstateOf } from './errors.ts';
import type { Logger } from './logger.ts';
import { RateLimiter } from './rate-limit.ts';
import { needsRehash, hashPassword, verifyPassword } from './auth/password.ts';
import { attemptKey, clearCookie, csrfFor, hashToken, ipHash, newToken, readCookie, safeEqual, sessionCookie } from './auth/session.ts';
import * as S from './admin/schemas.ts';

export interface Session {
  readonly sessionId: string; readonly userId: string; readonly email: string; readonly role: string;
  /** legacy: sessions created by the old two-step login; they are NEVER accepted as signed in (only logout may revoke them) */
  readonly mfaPending: boolean; readonly token: string; readonly expiresAt: Date;
}
export interface AdminEnv { Variables: { requestId: string; session: Session } }

export interface AdminDeps {
  config: AdminConfig; db: Db; logger: Logger;
  limiter?: RateLimiter;
  /** the caller's network address (used only to derive keyed hashes). Default: the connection's remote address. */
  clientAddress?: (c: Context) => string;
}

type Stage = 'none' | 'full' | 'any';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_HEADER_VALUE = 'newscafe-admin';
const honoPath = (p: string): string => p.replace(/\{(\w+)\}/g, ':$1');

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in.', forbidden: 'You are not allowed to do that.', invalid_credentials: 'The e-mail address or password is not correct.',
  rate_limited: 'Too many attempts. Please wait and try again.', csrf_origin: 'Request not allowed from this origin.',
  csrf_header: 'Missing required header.', csrf_token: 'Missing or invalid CSRF token.', validation_failed: 'The request is not valid.',
  not_found: 'Not found.', method_not_allowed: 'Method not allowed.', conflict: 'That cannot be done in the current state.', unsupported_media_type: 'Send the request as application/json.',
  payload_too_large: 'The request is too large.', malformed_json: 'The request body is not valid JSON.', service_unavailable: 'The service is temporarily unavailable. Please try again.',
  internal_error: 'Something went wrong.', 
  not_configured: 'Booking rules are not configured yet.', no_availability: 'No table is available for that.', status_change_not_allowed: 'That status change is not allowed.',
  not_on_slot: 'Please choose a time on the booking grid.', invalid_input: 'Some details are not valid.', table_taken: 'That table is no longer free.',
  party_size_not_allowed: 'That party size is not allowed.', outcome_unknown: 'The result could not be confirmed. Check the reservation before trying again.',
};

const RESERVATION_SELECT = `
  SELECT r.id, r.reference, r.status, r.party_size, r.starts_at, r.ends_at, r.duration_minutes, r.guest_name, r.guest_email::text AS guest_email,
         r.guest_phone, r.notes, r.source, r.is_test, r.consent_at, r.created_at, r.updated_at, r.confirmed_at, r.cancelled_at, r.cancel_reason,
         COALESCE((SELECT array_agg(t.label ORDER BY t.label) FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id
                    WHERE a.reservation_id = r.id AND a.active AND a.kind = 'reservation'), '{}') AS tables
    FROM reservations r JOIN locations l ON l.id = r.location_id`;

export function buildAdminApp(deps: AdminDeps) {
  const { config: cfg, db, logger } = deps;
  const limiter = deps.limiter ?? new RateLimiter();
  const T = cfg.tuning;
  const address = deps.clientAddress ?? ((c: Context): string =>
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? 'unknown');
  const rid = (c: Context<AdminEnv>): string => c.get('requestId');
  const body = (c: Context<AdminEnv>, code: string, extra: Record<string, unknown> = {}) => ({ error: code, message: MESSAGES[code] ?? MESSAGES['internal_error'], request_id: rid(c), ...extra });
  const deny = (c: Context<AdminEnv>, status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 429 | 500 | 503, code: string, extra: Record<string, unknown> = {}): Response => c.json(body(c, code, extra), status);

  // A hash computed once so that "no such owner" costs the same time as "wrong password" (no way to learn which e-mails exist).
  let dummy: Promise<string> | null = null;
  const dummyHash = (): Promise<string> => (dummy ??= hashPassword('not-a-real-password-for-timing-only', T.argon2));

  const app = new OpenAPIHono<AdminEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = result.error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.') || '(body)', code: i.code }));
        return c.json(body(c, 'validation_failed', { issues }), 422);
      }
      return undefined;
    },
  });

  // ---- base middleware ---------------------------------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    const started = performance.now();
    const id = randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id); c.header('Cache-Control', 'no-store'); c.header('Pragma', 'no-cache');
    c.header('X-Content-Type-Options', 'nosniff'); c.header('X-Frame-Options', 'DENY'); c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); c.header('Cross-Origin-Resource-Policy', 'same-site');
    await next();
    const matched = c.req.matchedRoutes.at(-1)?.path ?? '*';
    logger.info('request', { request_id: id, method: c.req.method, route: matched === '*' || matched === '/*' ? '(unmatched)' : matched, status: c.res.status, duration_ms: Math.round(performance.now() - started) });
  });
  app.use('/api/admin/*', cors({
    origin: cfg.allowedOrigin, credentials: true, maxAge: 600,
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Requested-With', 'Idempotency-Key'],
  }));
  app.use('/api/admin/*', bodyLimit({ maxSize: T.bodyLimitBytes, onError: (c) => deny(c as Context<AdminEnv>, 413, 'payload_too_large') }));

  // ---- failures ---------------------------------------------------------------------------------------------------------------
  const unavailable = (c: Context<AdminEnv>, err: unknown): Response => {
    const unknownOutcome = err instanceof DbOutcomeUnknown;
    logger.warn('request_failed', { request_id: rid(c), code: sqlstateOf(err) ?? 'db', error_class: err instanceof Error ? err.name : 'unknown', outcome: unknownOutcome ? 'outcome_unknown' : 'service_unavailable' });
    return deny(c, 503, unknownOutcome ? 'outcome_unknown' : 'service_unavailable');
  };
  /** Maps anything thrown by a handler to a safe answer (never SQL text, never a stack trace). */
  const fail = (c: Context<AdminEnv>, err: unknown): Response => {
    if (err instanceof DbUnavailable || err instanceof DbOutcomeUnknown || err instanceof DbEnvironmentRefused) return unavailable(c, err);
    const state = sqlstateOf(err);
    const known: Record<string, [409 | 422 | 403 | 404 | 503, string]> = {
      NC906: [403, 'forbidden'], NC907: [409, 'status_change_not_allowed'], NC909: [404, 'not_found'], NC001: [409, 'not_configured'], NC002: [409, 'no_availability'],
      '23P01': [409, 'table_taken'], NC004: [422, 'party_size_not_allowed'], NC006: [422, 'not_on_slot'], NC005: [422, 'invalid_input'], NC007: [422, 'invalid_input'],
      NC008: [422, 'invalid_input'], '22023': [422, 'invalid_input'], '22007': [422, 'invalid_input'], '22008': [422, 'invalid_input'], '22P02': [422, 'invalid_input'],
      '23514': [422, 'invalid_input'], '57014': [503, 'service_unavailable'], '55P03': [503, 'service_unavailable'], '53300': [503, 'service_unavailable'],
    };
    const hit = state ? known[state] : undefined;
    if (hit) { logger.warn('request_failed', { request_id: rid(c), code: state, outcome: hit[1] }); return deny(c, hit[0], hit[1]); }
    logger.error('request_failed', { request_id: rid(c), code: state ?? 'none', error_class: err instanceof Error ? err.name : 'unknown', outcome: 'internal_error' });
    return deny(c, 500, 'internal_error');
  };

  // ---- sessions ---------------------------------------------------------------------------------------------------------------
  const loadSession = async (c: Context<AdminEnv>): Promise<Session | null> => {
    const token = readCookie(c.req.header('cookie'));
    if (!token) return null;
    const r = await db.query<{ id: string; user_id: string; mfa_pending: boolean; expires_at: Date; email: string; role: string }>(
      `SELECT s.id, s.user_id, s.mfa_pending, s.expires_at, u.email::text AS email, u.role
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(secs => $2) AND u.is_active`, [hashToken(token), T.sessionIdleSeconds]);
    const row = r.rows[0];
    if (!row) return null;
    // keep the idle clock moving, at most once a minute
    await db.query(`UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '60 seconds'`, [row.id]);
    return { sessionId: row.id, userId: row.user_id, email: row.email, role: row.role, mfaPending: row.mfa_pending, token, expiresAt: row.expires_at };
  };

  /** Route guard. Registered per route + method, so nothing is protected by accident of ordering. */
  const guard = (method: string, stage: Stage): MiddlewareHandler<AdminEnv> => async (c, next) => {
    if (c.req.method !== method) { await next(); return; }
    if (UNSAFE.has(method)) {                                              // CSRF layers 1 and 2: who is asking, and was it deliberate
      if (c.req.header('origin') !== cfg.allowedOrigin) return deny(c, 403, 'csrf_origin');
      if (c.req.header('x-requested-with') !== CSRF_HEADER_VALUE) return deny(c, 403, 'csrf_header');
    }
    if (stage === 'none') { await next(); return; }
    let session: Session | null;
    try { session = await loadSession(c); } catch (err) { return unavailable(c, err); }
    if (!session) { c.header('Set-Cookie', clearCookie(cfg.secureCookies)); return deny(c, 401, 'unauthenticated'); }
    if (session.role !== 'owner') return deny(c, 403, 'forbidden');        // defence in depth: owner-only even if a role changed mid-session
    // An old half-finished two-step sign-in (mfa_pending) is never a signed-in owner. Only 'any' (logout) may still see it, so it can be revoked.
    if (stage === 'full' && session.mfaPending) { c.header('Set-Cookie', clearCookie(cfg.secureCookies)); return deny(c, 401, 'unauthenticated'); }
    if (UNSAFE.has(method) && !safeEqual(c.req.header('x-csrf-token') ?? '', csrfFor(cfg.hmacKey, session.token))) return deny(c, 403, 'csrf_token');   // layer 3
    c.set('session', session);
    await next();
  };
  const requireJson: MiddlewareHandler<AdminEnv> = async (c, next) => {
    if (UNSAFE.has(c.req.method) && c.req.header('content-length') !== '0' && c.req.header('content-length') !== undefined
        && !/^application\/json(\s*;.*)?$/i.test(c.req.header('content-type') ?? '')) return deny(c, 415, 'unsupported_media_type');
    await next();
  };
  const protect = (method: string, path: string, stage: Stage, rate?: { name: string; limit: number; windowMs: number }): void => {
    app.use(honoPath(path), requireJson);
    if (rate) app.use(honoPath(path), async (c, next) => {
      if (c.req.method === method) {
        const r = limiter.hit(`${rate.name}:${ipHash(cfg.hmacKey, address(c))}`, rate.limit, rate.windowMs);
        if (!r.allowed) { c.header('Retry-After', String(r.retryAfterSec)); return deny(c, 429, 'rate_limited'); }
      }
      await next();
    });
    app.use(honoPath(path), guard(method, stage));
  };

  const audit = (q: Queryable, actor: string | null, action: string, entityId: string | null, after: Record<string, unknown> | null, ip: string): Promise<unknown> =>
    q.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after, ip_hash) VALUES ($1, $2, 'admin_user', $3, $4::jsonb, $5)`,
      [actor, action, entityId, after === null ? null : JSON.stringify(after), ip]);
  const newSession = async (q: Queryable, c: Context<AdminEnv>, userId: string): Promise<{ token: string; expiresAt: Date }> => {
    const token = newToken();
    const r = await q.query<{ expires_at: Date }>(
      `INSERT INTO admin_sessions (user_id, token_hash, expires_at, ip_hash, user_agent)
       VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5) RETURNING expires_at`,
      [userId, hashToken(token), T.sessionAbsoluteSeconds, ipHash(cfg.hmacKey, address(c)), (c.req.header('user-agent') ?? '').slice(0, 120) || null]);
    return { token, expiresAt: r.rows[0]?.expires_at ?? new Date() };
  };
  const setCookie = (c: Context<AdminEnv>, token: string): void => {
    c.header('Set-Cookie', sessionCookie(token, T.sessionAbsoluteSeconds, cfg.secureCookies));
  };
  /** Counts one wrong password against the account; returns true if the account just got locked. */
  const registerFailure = async (q: Queryable, userId: string): Promise<boolean> => {
    const r = await q.query<{ locked: boolean }>(
      `UPDATE admin_users SET
         failed_logins = CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_logins + 1 END,
         locked_until  = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_logins + 1 END) >= $2 THEN now() + make_interval(secs => $3)
                              WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL ELSE locked_until END
        WHERE id = $1 RETURNING (locked_until IS NOT NULL AND locked_until > now()) AS locked`, [userId, T.lockoutFailures, T.lockoutSeconds]);
    return r.rows[0]?.locked ?? false;
  };
  const revokeSession = (q: Queryable, id: string): Promise<unknown> => q.query('UPDATE admin_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  const err = (desc: string) => ({ description: desc, content: { 'application/json': { schema: S.AdminError } } });
  const ok = (desc: string, schema: z.ZodType) => ({ description: desc, content: { 'application/json': { schema } } });
  const json = <B extends z.ZodType>(schema: B) => ({ required: true as const, content: { 'application/json': { schema } } });
  const secured = { tags: ['Admin'] as string[] };

  // =============================================================================================================================
  // LOGIN
  // =============================================================================================================================
  protect('POST', '/api/admin/login', 'none', { name: 'login', limit: 30, windowMs: 15 * 60_000 });
  app.openapi(createRoute({
    method: 'post', path: '/api/admin/login', tags: ['Admin sign-in'], summary: 'Sign in with e-mail and password',
    description: 'Unknown e-mail, wrong password and locked account all answer the same `401 invalid_credentials` (no way to learn which owners exist). '
      + 'On success the full session cookie (HttpOnly, SameSite=Strict) is set at once and the CSRF token is returned. There is no second step.',
    request: { body: json(S.LoginBody) },
    responses: { 200: ok('Signed in.', S.SignedIn), 401: err('Invalid credentials.'), 403: err('Origin / header check failed.'), 422: err('Validation failed.'), 429: err('Too many attempts.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const { email, password } = c.req.valid('json');
    const ip = address(c);
    const key = attemptKey(cfg.hmacKey, ip, email);
    const iph = ipHash(cfg.hmacKey, ip);
    try {
      const recent = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM login_attempts WHERE key_hash = $1 AND NOT success AND attempted_at > now() - interval '15 minutes'`, [key]);
      if ((recent.rows[0]?.n ?? 0) >= 10) { c.header('Retry-After', '900'); return deny(c, 429, 'rate_limited') as never; }
      const u = (await db.query<{ id: string; email: string; password_hash: string; role: string; is_active: boolean; locked: boolean }>(
        `SELECT id, email::text AS email, password_hash, role, is_active, (locked_until IS NOT NULL AND locked_until > now()) AS locked
           FROM admin_users WHERE email = $1::citext`, [email])).rows[0];
      const eligible = u !== undefined && u.is_active && u.role === 'owner';
      const passwordOk = await verifyPassword(eligible ? u.password_hash : await dummyHash(), password);   // same work either way
      if (!eligible || !passwordOk || u.locked) {
        await db.tx(async (q) => {
          await q.query('INSERT INTO login_attempts (key_hash, success) VALUES ($1, false)', [key]);
          let locked = false;
          if (eligible && !u.locked) locked = await registerFailure(q, u.id);
          await audit(q, eligible ? u.id : null, locked ? 'auth.locked' : 'auth.login_failed', eligible ? u.id : null, { reason: !eligible ? 'unknown_or_ineligible' : u.locked ? 'locked' : 'bad_password' }, iph);
        });
        logger.warn('auth_event', { request_id: rid(c), outcome: 'login_failed' });
        return deny(c, 401, 'invalid_credentials') as never;
      }
      const upgraded = needsRehash(u.password_hash, T.argon2) ? await hashPassword(password, T.argon2) : null;
      const session = await db.tx(async (q) => {
        await q.query('INSERT INTO login_attempts (key_hash, success) VALUES ($1, true)', [key]);
        if (upgraded) await q.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [u.id, upgraded]);
        const s = await newSession(q, c, u.id);                              // a brand-new random token every time: nothing is ever "upgraded"
        await q.query('UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
        await audit(q, u.id, 'auth.login', u.id, { method: 'password' }, iph);
        return s;
      });
      setCookie(c, session.token);
      return c.json({ signed_in: true as const, csrf_token: csrfFor(cfg.hmacKey, session.token), user: { email: u.email, role: u.role }, session_expires_at: session.expiresAt.toISOString() }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  // =============================================================================================================================
  // SIGNED-IN SESSION
  // =============================================================================================================================
  protect('POST', '/api/admin/logout', 'any');
  app.openapi(createRoute({
    method: 'post', path: '/api/admin/logout', tags: ['Admin sign-in'], summary: 'Sign out (revokes the session on the server)',
    responses: { 204: { description: 'Signed out.' }, 401: err('Not signed in.'), 403: err('CSRF check failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const s = c.get('session');
    try {
      await db.tx(async (q) => { await revokeSession(q, s.sessionId); await audit(q, s.userId, 'auth.logout', s.userId, null, ipHash(cfg.hmacKey, address(c))); });
      c.header('Set-Cookie', clearCookie(cfg.secureCookies));
      return c.body(null, 204);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('GET', '/api/admin/me', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/me', tags: ['Admin sign-in'], summary: 'Who am I? (also returns the CSRF token the dashboard must send)',
    responses: { 200: ok('Signed in.', S.Me), 401: err('Not signed in.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const s = c.get('session');
    return c.json({ user: { email: s.email, role: s.role }, csrf_token: csrfFor(cfg.hmacKey, s.token), session_expires_at: s.expiresAt.toISOString(), idle_timeout_seconds: T.sessionIdleSeconds }, 200);
  });

  // =============================================================================================================================
  // RESERVATIONS
  // =============================================================================================================================
  const ipOf = (c: Context<AdminEnv>): string => ipHash(cfg.hmacKey, address(c));
  const fetchReservation = async (id: string): Promise<Record<string, unknown> | null> =>
    (await db.query<Record<string, unknown>>(`${RESERVATION_SELECT} WHERE r.id = $1`, [id])).rows[0] ?? null;
  const like = (q: string): string => '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';

  protect('GET', '/api/admin/reservations', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/reservations', tags: ['Admin reservations'], summary: 'List / search reservations',
    description: 'Filter by local date range, status, free text (name, e-mail, phone, reference). Test bookings are hidden unless `include_test=true`. Contains guest personal data: owner only, never cached.',
    request: { query: S.ListQuery },
    responses: { 200: ok('Reservations.', S.ReservationList), 401: err('Not signed in.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const q = c.req.valid('query');
    try {
      const r = await db.query<Record<string, unknown>>(
        `${RESERVATION_SELECT}
          WHERE ($1::date IS NULL OR r.starts_at >= ($1::date::timestamp AT TIME ZONE l.timezone))
            AND ($2::date IS NULL OR r.starts_at < (($2::date + 1)::timestamp AT TIME ZONE l.timezone))
            AND ($3::text IS NULL OR r.status = $3)
            AND ($4::boolean OR NOT r.is_test)
            AND ($5::text IS NULL OR r.guest_name ILIKE $5 ESCAPE '\\' OR r.guest_email::text ILIKE $5 ESCAPE '\\' OR r.guest_phone ILIKE $5 ESCAPE '\\' OR r.reference ILIKE $5 ESCAPE '\\')
          ORDER BY r.starts_at, r.id LIMIT $6 OFFSET $7`,
        [q.from ?? null, q.to ?? null, q.status ?? null, q.include_test === 'true', q.q === undefined ? null : like(q.q), q.limit + 1, q.offset]);
      return c.json({ items: r.rows.slice(0, q.limit), has_more: r.rows.length > q.limit }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('GET', '/api/admin/reservations/{id}', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/reservations/{id}', tags: ['Admin reservations'], summary: 'One reservation (viewing guest details is audited)',
    request: { params: S.IdParam },
    responses: { 200: ok('The reservation.', S.ReservationOut), 401: err('Not signed in.'), 404: err('Not found.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const { id } = c.req.valid('param'); const s = c.get('session');
    try {
      const row = await fetchReservation(id);
      if (!row) return deny(c, 404, 'not_found') as never;
      await db.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, ip_hash) VALUES ($1, 'reservation.view', 'reservation', $2, $3)`, [s.userId, id, ipOf(c)]);
      return c.json({ reservation: row }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('GET', '/api/admin/reservations/{id}/history', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/reservations/{id}/history', tags: ['Admin reservations'], summary: 'Full change history of a reservation (append-only)',
    request: { params: S.IdParam },
    responses: { 200: ok('History, oldest first.', S.Rows), 401: err('Not signed in.'), 404: err('Not found.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const { id } = c.req.valid('param'); const s = c.get('session');
    try {
      if (!(await fetchReservation(id))) return deny(c, 404, 'not_found') as never;
      const r = await db.query<Record<string, unknown>>(
        `SELECT e.id, e.at, e.action, e.old_status, e.new_status, e.changes, e.actor, u.email::text AS actor_email
           FROM reservation_events e LEFT JOIN admin_users u ON u.id::text = e.actor WHERE e.reservation_id = $1 ORDER BY e.id`, [id]);
      await db.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, ip_hash) VALUES ($1, 'reservation.history_view', 'reservation', $2, $3)`, [s.userId, id, ipOf(c)]);
      return c.json({ items: r.rows }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('POST', '/api/admin/reservations', 'full');
  app.openapi(createRoute({
    method: 'post', path: '/api/admin/reservations', tags: ['Admin reservations'], summary: 'Staff booking (phone / walk-in / admin)',
    description: 'Confirmed immediately. May use walk-in-only tables; not bound by notice or opening hours. `is_test: true` marks a test booking. Optional `Idempotency-Key` header.',
    request: { body: json(S.StaffCreateBody) },
    responses: { 201: ok('Created.', S.ReservationOut), 401: err('Not signed in.'), 403: err('CSRF check failed.'), 409: err('No table / not configured.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const b = c.req.valid('json'); const s = c.get('session');
    try {
      const key = c.req.header('idempotency-key');
      if (key !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return deny(c, 422, 'validation_failed', { issues: [{ path: 'idempotency-key', code: 'invalid_format' }] }) as never;
      const r = await db.query<{ id: string }>('SELECT admin_create_reservation($1::uuid, $2::int, $3::timestamptz, $4, $5, $6, $7, $8, $9::boolean, $10, $11) AS id',
        [s.userId, b.party_size, b.starts_at, b.name, b.email ?? null, b.phone ?? null, b.notes ?? null, b.source, b.is_test ?? false, key ?? null, ipOf(c)]);
      const row = await fetchReservation(r.rows[0]?.id ?? '');
      return c.json({ reservation: row ?? {} }, 201);
    } catch (e) { return fail(c, e) as never; }
  });

  const statusAction = (action: 'confirm' | 'cancel' | 'complete' | 'no-show' | 'reinstate', summary: string, withReason: boolean): void => {
    const path = `/api/admin/reservations/{id}/${action}`;
    protect('POST', path, 'full');
    app.openapi(createRoute({
      method: 'post', path, tags: ['Admin reservations'], summary,
      request: withReason ? { params: S.IdParam, body: { required: false, content: { 'application/json': { schema: S.CancelBody } } } } : { params: S.IdParam },
      responses: { 200: ok('Updated reservation.', S.ReservationOut), 401: err('Not signed in.'), 403: err('CSRF check failed.'), 404: err('Not found.'), 409: err('Status change not allowed, or the table is no longer free.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
    }), async (c) => {
      const { id } = c.req.valid('param'); const s = c.get('session');
      try {
        const reason = withReason ? ((c.req.valid('json' as never) as { reason?: string } | undefined)?.reason ?? null) : null;
        let target: string;
        if (action === 'confirm') {
          // "confirm" is for a pending request only; a cancelled / no-show booking comes back through "reinstate"
          const cur = (await db.query<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [id])).rows[0];
          if (!cur) return deny(c, 404, 'not_found') as never;
          if (cur.status !== 'pending') return deny(c, 409, 'status_change_not_allowed') as never;
          target = 'confirmed';
        }
        else if (action === 'cancel') target = 'cancelled';
        else if (action === 'complete') target = 'completed';
        else if (action === 'no-show') target = 'no_show';
        else {                                                           // reinstate: back to where it was before it was cancelled / marked no-show
          const was = (await db.query<{ was: boolean }>('SELECT (confirmed_at IS NOT NULL) AS was FROM reservations WHERE id = $1', [id])).rows[0];
          if (!was) return deny(c, 404, 'not_found') as never;
          target = was.was ? 'confirmed' : 'pending';
        }
        await db.query('SELECT admin_set_reservation_status($1::uuid, $2::uuid, $3, $4, $5)', [s.userId, id, target, reason, ipOf(c)]);
        return c.json({ reservation: (await fetchReservation(id)) ?? {} }, 200);
      } catch (e) { return fail(c, e) as never; }
    });
  };
  statusAction('confirm', 'Confirm a pending reservation', false);
  statusAction('cancel', 'Cancel a reservation (optional reason); releases the table', true);
  statusAction('complete', 'Mark a confirmed reservation completed', false);
  statusAction('no-show', 'Mark a confirmed reservation as a no-show; releases the table', false);
  statusAction('reinstate', 'Bring back a cancelled / no-show reservation (re-checks the table)', false);

  protect('POST', '/api/admin/reservations/{id}/move', 'full');
  app.openapi(createRoute({
    method: 'post', path: '/api/admin/reservations/{id}/move', tags: ['Admin reservations'], summary: 'Move: time, party size, duration and/or table (atomic)',
    description: 'All or nothing: if the new time/table is not free, nothing changes. A changed party size without an explicit duration re-applies the owner\'s duration rules.',
    request: { params: S.IdParam, body: json(S.MoveBody) },
    responses: { 200: ok('Moved.', S.ReservationOut), 401: err('Not signed in.'), 403: err('CSRF check failed.'), 404: err('Not found.'), 409: err('No table free / status does not allow a move.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const { id } = c.req.valid('param'); const b = c.req.valid('json'); const s = c.get('session');
    try {
      await db.query('SELECT admin_move_reservation($1::uuid, $2::uuid, $3::timestamptz, $4::int, $5::int, $6::uuid, $7)', [s.userId, id, b.starts_at ?? null, b.party_size ?? null, b.duration_minutes ?? null, b.table_id ?? null, ipOf(c)]);
      return c.json({ reservation: (await fetchReservation(id)) ?? {} }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('PATCH', '/api/admin/reservations/{id}', 'full');
  app.openapi(createRoute({
    method: 'patch', path: '/api/admin/reservations/{id}', tags: ['Admin reservations'], summary: 'Edit guest name, e-mail, phone or notes (nothing else)',
    description: 'Times, party size, tables and status change only through their own endpoints. `null` clears an e-mail / phone / notes (one contact method must remain).',
    request: { params: S.IdParam, body: json(S.EditBody) },
    responses: { 200: ok('Updated.', S.ReservationOut), 401: err('Not signed in.'), 403: err('CSRF check failed.'), 404: err('Not found.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const { id } = c.req.valid('param'); const b = c.req.valid('json'); const s = c.get('session');
    try {
      await db.query('SELECT admin_edit_reservation($1::uuid, $2::uuid, $3::jsonb, $4)', [s.userId, id, JSON.stringify(b), ipOf(c)]);
      return c.json({ reservation: (await fetchReservation(id)) ?? {} }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  // =============================================================================================================================
  // READ-ONLY: audit log, readiness, tables
  // =============================================================================================================================
  protect('GET', '/api/admin/audit-log', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/audit-log', tags: ['Admin audit'], summary: 'Audit log (read-only, newest first)',
    description: 'Who did what and when. Never contains guest names, e-mails, phones or notes. Page backwards with `before=<id of the oldest row you have>`.',
    request: { query: S.AuditQuery },
    responses: { 200: ok('Audit rows.', S.Rows), 401: err('Not signed in.'), 422: err('Validation failed.'), 503: err('Service unavailable.') },
  }), async (c) => {
    const q = c.req.valid('query');
    try {
      const r = await db.query<Record<string, unknown>>(
        `SELECT a.id, a.at, a.actor_id, u.email::text AS actor_email, a.action, a.entity_type, a.entity_id, a.before, a.after
           FROM audit_logs a LEFT JOIN admin_users u ON u.id = a.actor_id
          WHERE ($1::bigint IS NULL OR a.id < $1) ORDER BY a.id DESC LIMIT $2`, [q.before ?? null, q.limit]);
      return c.json({ items: r.rows }, 200);
    } catch (e) { return fail(c, e) as never; }
  });

  protect('GET', '/api/admin/readiness', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/readiness', tags: ['Admin audit'], summary: 'What is still missing before online booking can be switched on',
    responses: { 200: ok('Readiness checklist.', S.Row), 401: err('Not signed in.'), 503: err('Service unavailable.') },
  }), async (c) => {
    try { return c.json({ item: (await db.query<Record<string, unknown>>('SELECT * FROM reservation_readiness ORDER BY name LIMIT 1')).rows[0] ?? null }, 200); }
    catch (e) { return fail(c, e) as never; }
  });

  protect('GET', '/api/admin/tables', 'full');
  app.openapi(createRoute({
    method: 'get', path: '/api/admin/tables', tags: ['Admin reservations'], summary: 'Tables (read-only; for the "move to table" picker)',
    responses: { 200: ok('Tables.', S.Rows), 401: err('Not signed in.'), 503: err('Service unavailable.') },
  }), async (c) => {
    try { return c.json({ items: (await db.query<Record<string, unknown>>('SELECT id, label, section, min_covers, max_covers, is_active, online_bookable FROM dining_tables ORDER BY sort, label')).rows }, 200); }
    catch (e) { return fail(c, e) as never; }
  });

  // ---- everything else -----------------------------------------------------------------------------------------------------------
  app.notFound((c) => {
    const p = new URL(c.req.url).pathname;
    const known = app.routes.some((r) => r.method !== 'ALL' && new RegExp('^' + r.path.replace(/:\w+/g, '[^/]+') + '$').test(p));
    return known ? deny(c, 405, 'method_not_allowed') : deny(c, 404, 'not_found');
  });
  app.onError((e, c) => {
    if (e instanceof HTTPException) return deny(c, e.status === 400 ? 400 : e.status === 413 ? 413 : 500, e.status === 400 ? 'malformed_json' : e.status === 413 ? 'payload_too_large' : 'internal_error');
    logger.error('unhandled_error', { request_id: rid(c), error_class: e instanceof Error ? e.name : 'unknown' });
    return deny(c, 500, 'internal_error');
  });

  return app;
}

/** Keyed hash used for derived values; exported for tests that need to build the same keys the server does. */
export const _hmac = (key: Buffer, label: string, value: string): string => createHmac('sha256', key).update(label + value).digest('hex');
