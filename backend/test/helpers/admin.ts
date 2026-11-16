// Helpers for the owner (admin) API tests: a fake-owner factory (superuser fixture insert, fake @example.invalid addresses only),
// and a browser-like client with a cookie jar and CSRF handling. Sign-in is e-mail + password only.
import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { buildAdminApp } from '../../src/admin-app.ts';
import { loadAdminConfig } from '../../src/config.ts';
import type { AdminConfig, Tuning } from '../../src/config.ts';
import { Db } from '../../src/db.ts';
import { createLogger } from '../../src/logger.ts';
import { hashPassword } from '../../src/auth/password.ts';
import { csrfFor, hashToken, newToken } from '../../src/auth/session.ts';
import { rows, su, testAdminEnv } from './fixtures.ts';

export const ORIGIN = 'http://localhost:3000';
export const WEAK_ARGON2 = { memoryCost: 8192, timeCost: 1, parallelism: 1 };   // fast for tests; production uses 64 MiB x 3

export interface TestAdminApp {
  app: ReturnType<typeof buildAdminApp>; db: Db; config: AdminConfig; logs: string[]; close(): Promise<void>;
}
export function makeAdminApp(overrides: Record<string, string | undefined> = {}, tuning: Partial<Tuning> = {}): TestAdminApp {
  const config = loadAdminConfig(testAdminEnv(overrides), { tuning: { argon2: WEAK_ARGON2, dbCooldownMs: 50, ...tuning } });
  const logs: string[] = [];
  const logger = createLogger((l) => logs.push(l));
  const db = new Db({ host: config.dbHost, port: config.dbPort, database: config.dbName, user: config.dbUser, password: config.dbPassword,
    tuning: { ...config.tuning, poolMax: 4 }, envProbe: 'SELECT env FROM app_environment' }, logger);
  const app = buildAdminApp({ config, db, logger, clientAddress: (c: Context) => c.req.header('x-test-client') ?? 'default-client' });
  return { app, db, config, logs, close: () => db.close() };
}

export interface TestOwner { id: string; email: string; password: string }
export async function createOwner(_t: TestAdminApp, opts: { role?: 'owner' | 'manager'; active?: boolean; password?: string } = {}): Promise<TestOwner> {
  const id = randomUUID(); const email = `owner-${id.slice(0, 8)}@example.invalid`; const password = opts.password ?? `Pw-${randomUUID()}`;
  const c = await su();
  try {
    await c.query('INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5)', [id, email, await hashPassword(password, WEAK_ARGON2), opts.role ?? 'owner', opts.active ?? true]);
    return { id, email, password };
  } finally { await c.end(); }
}

/**
 * A session left over from the OLD two-step sign-in (password accepted, second step never done): mfa_pending = true, still unexpired.
 * It must never be accepted as a signed-in owner. Returns its cookie and the CSRF token the old API would have handed out.
 */
export async function legacyPendingSession(t: TestAdminApp, owner: TestOwner): Promise<{ cookie: string; csrf: string }> {
  const token = newToken(); const c = await su();
  try {
    await c.query("INSERT INTO admin_sessions (user_id, token_hash, expires_at, mfa_pending) VALUES ($1, $2, now() + interval '10 minutes', true)", [owner.id, hashToken(token)]);
  } finally { await c.end(); }
  return { cookie: `nc_admin_session=${token}`, csrf: csrfFor(t.config.hmacKey, token) };
}

export class Client {
  cookie: string | null = null; csrf: string | null = null; readonly id = randomUUID();
  readonly app: TestAdminApp['app'];
  constructor(app: TestAdminApp['app']) { this.app = app; }

  async req(method: string, path: string, o: { body?: unknown; raw?: string; origin?: string | null; csrf?: string | null; headers?: Record<string, string>; noCookie?: boolean; xrw?: boolean } = {}): Promise<Response> {
    const h: Record<string, string> = { 'x-test-client': this.id, ...o.headers };
    if (o.origin !== null) h['origin'] = o.origin ?? ORIGIN;
    if (o.xrw !== false) h['x-requested-with'] = 'newscafe-admin';
    if (!o.noCookie && this.cookie) h['cookie'] = this.cookie;
    const token = o.csrf === undefined ? this.csrf : o.csrf;
    if (token) h['x-csrf-token'] = token;
    let body: string | undefined;
    if (o.raw !== undefined) { body = o.raw; h['content-type'] = h['content-type'] ?? 'application/json'; }
    else if (o.body !== undefined) { body = JSON.stringify(o.body); h['content-type'] = 'application/json'; }
    const res = await this.app.request(path, { method, headers: h, body });
    const set = res.headers.get('set-cookie');
    if (set) { const m = /^nc_admin_session=([^;]*)/.exec(set); if (m) this.cookie = /Max-Age=0/i.test(set) || !m[1] ? null : `nc_admin_session=${m[1]}`; }
    // like the dashboard: remember the CSRF token that sign-in / me hand out
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      try { const j = (await res.clone().json()) as { csrf_token?: unknown }; if (typeof j.csrf_token === 'string') this.csrf = j.csrf_token; } catch { /* not JSON */ }
    }
    return res;
  }
  async json(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }

  /** e-mail + password -> full session at once (there is no second step). Returns the response. */
  async signIn(owner: TestOwner): Promise<Response> {
    return this.req('POST', '/api/admin/login', { body: { email: owner.email, password: owner.password } });
  }
}

export async function sessionRows(userId: string): Promise<{ id: string; revoked_at: Date | null; mfa_pending: boolean; token_hash: Buffer }[]> {
  return rows('SELECT id, revoked_at, mfa_pending, token_hash FROM admin_sessions WHERE user_id = $1 ORDER BY created_at', [userId]);
}
export const userRow = async (id: string) =>
  (await rows<{ failed_logins: number; locked_until: Date | null; last_login_at: Date | null; password_hash: string }>(
    'SELECT failed_logins, locked_until, last_login_at, password_hash FROM admin_users WHERE id = $1', [id]))[0]!;
export const auditFor = (userId: string, action?: string) =>
  rows<{ id: string; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; ip_hash: string | null; actor_id: string | null }>(
    `SELECT id, action, entity_type, entity_id, before, after, ip_hash, actor_id FROM audit_logs WHERE (actor_id = $1::uuid OR entity_id = $1::text) ${action ? 'AND action = $2' : ''} ORDER BY id`, action ? [userId, action] : [userId]);
