// Authorisation for EVERY admin endpoint. The list of routes is read from the running application, and a classification table must
// match it exactly: adding an endpoint without deciding who may call it makes this test fail.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csrfFor, hashToken, newToken } from '../src/auth/session.ts';
import { Client, createOwner, legacyPendingSession, makeAdminApp, ORIGIN } from './helpers/admin.ts';
import type { TestAdminApp, TestOwner } from './helpers/admin.ts';
import { ensureVenue, makePending, freshDay, su } from './helpers/fixtures.ts';

type Access = 'public' | 'any' | 'full';
const EXPECTED: Record<string, Access> = {
  'POST /api/admin/login': 'public',
  'POST /api/admin/logout': 'any',
  'GET /api/admin/me': 'full',
  'GET /api/admin/reservations': 'full',
  'POST /api/admin/reservations': 'full',
  'GET /api/admin/reservations/:id': 'full',
  'PATCH /api/admin/reservations/:id': 'full',
  'GET /api/admin/reservations/:id/history': 'full',
  'POST /api/admin/reservations/:id/confirm': 'full',
  'POST /api/admin/reservations/:id/cancel': 'full',
  'POST /api/admin/reservations/:id/complete': 'full',
  'POST /api/admin/reservations/:id/no-show': 'full',
  'POST /api/admin/reservations/:id/reinstate': 'full',
  'POST /api/admin/reservations/:id/move': 'full',
  'GET /api/admin/audit-log': 'full',
  'GET /api/admin/readiness': 'full',
  'GET /api/admin/tables': 'full',
};

let t: TestAdminApp; let owner: TestOwner; let full: Client; let legacy: Client; let manager: Client;
const routes = (): { method: string; path: string; key: string }[] => {
  const seen = new Set<string>(); const out: { method: string; path: string; key: string }[] = [];
  for (const r of t.app.routes) {
    if (r.method === 'ALL' || !r.path.startsWith('/api/admin')) continue;
    const key = `${r.method} ${r.path}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ method: r.method, path: r.path.replace(':id', randomUUID()), key });
  }
  return out;
};
const call = (c: Client, r: { method: string; path: string }, o: Parameters<Client['req']>[2] = {}) =>
  c.req(r.method, r.path, { ...(r.method === 'GET' ? {} : { body: {} }), ...o });

beforeAll(async () => {
  await ensureVenue(); t = makeAdminApp();
  owner = await createOwner(t); full = new Client(t.app); await full.signIn(owner);
  // a half-finished session left over from the OLD two-step sign-in (mfa_pending = true, unexpired)
  const old = await legacyPendingSession(t, owner); legacy = new Client(t.app); legacy.cookie = old.cookie; legacy.csrf = old.csrf;
  // a manager account with a (hand-made) valid full session: owner-only means it must be refused everywhere
  const m = await createOwner(t, { role: 'manager' }); const token = newToken();
  const c = await su(); try { await c.query(`INSERT INTO admin_sessions (user_id, token_hash, expires_at, mfa_pending) VALUES ($1, $2, now() + interval '1 hour', false)`, [m.id, hashToken(token)]); } finally { await c.end(); }
  manager = new Client(t.app); manager.cookie = `nc_admin_session=${token}`; manager.csrf = csrfFor(t.config.hmacKey, token);
});
afterAll(async () => { await t.close(); });

describe('the list of admin endpoints is fully classified', () => {
  it('every route the application serves under /api/admin is in the table, and nothing in the table is missing', () => {
    expect(routes().map((r) => r.key).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('without a valid session', () => {
  it.each(Object.entries(EXPECTED).filter(([, a]) => a !== 'public'))('%s refuses callers with no cookie (401)', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const res = await call(new Client(t.app), r);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(/reservation|guest|SELECT/i);
  });
  it.each(Object.entries(EXPECTED).filter(([, a]) => a !== 'public'))('%s refuses a forged cookie (401)', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const bad = new Client(t.app); bad.cookie = 'nc_admin_session=' + newToken(); bad.csrf = 'x';
    expect((await call(bad, r)).status).toBe(401);
  });
  it.each(Object.entries(EXPECTED).filter(([, a]) => a !== 'public'))('%s refuses an expired session (401)', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const o = await createOwner(t); const c = new Client(t.app); await c.signIn(o);
    const s = await su(); try { await s.query(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [o.id]); } finally { await s.end(); }
    expect((await call(c, r)).status).toBe(401);
  });
  it('unsupported methods on admin paths answer 405 without touching any data or checking any session', async () => {
    for (const [method, path] of [['DELETE', `/api/admin/reservations/${randomUUID()}`], ['PUT', '/api/admin/reservations'], ['GET', '/api/admin/login'], ['POST', '/api/admin/me'], ['PATCH', '/api/admin/audit-log']]) {
      expect((await new Client(t.app).req(method!, path!, { body: method === 'GET' ? undefined : {} })).status, `${method} ${path}`).toBe(405);
    }
    expect((await new Client(t.app).req('GET', '/api/admin/nothing-here')).status).toBe(404);
  });
});

describe('an old half-finished two-step session is never a signed-in owner', () => {
  it.each(Object.entries(EXPECTED).filter(([, a]) => a === 'full'))('%s -> 401 (and the dead cookie is cleared)', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const res = await call(legacy, r);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/);
  });
  it('it cannot be used to read anything private, whatever the route', async () => {
    for (const path of ['/api/admin/me', '/api/admin/reservations', '/api/admin/audit-log', '/api/admin/tables', '/api/admin/readiness']) expect((await legacy.req('GET', path)).status, path).toBe(401);
  });
  it('the only thing it can still do is be signed out (so it can be revoked)', async () => {
    const o = await createOwner(t); const old = await legacyPendingSession(t, o); const c = new Client(t.app); c.cookie = old.cookie; c.csrf = old.csrf;
    expect((await c.req('POST', '/api/admin/logout')).status).toBe(204);
    expect((await c.req('POST', '/api/admin/logout')).status).toBe(401);
  });
});

describe('the second-factor routes are gone', () => {
  it.each(['/api/admin/login/totp', '/api/admin/login/recovery', '/api/admin/totp/enroll/start', '/api/admin/totp/enroll/confirm', '/api/admin/recovery-codes/regenerate'])('POST %s -> 404 for everybody, signed in or not', async (path) => {
    expect((await new Client(t.app).req('POST', path, { body: {} })).status).toBe(404);
    expect((await full.req('POST', path, { body: {} })).status).toBe(404);
    expect((await legacy.req('POST', path, { body: {} })).status).toBe(404);
  });
});

describe('a fully signed-in owner', () => {
  it.each(Object.entries(EXPECTED).filter(([, a]) => a === 'full'))('%s is allowed (anything but 401/403)', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const res = await call(full, r);
    expect([401, 403]).not.toContain(res.status);
  });
});

describe('owner-only: a manager account is refused everywhere, even with a valid session', () => {
  it.each(Object.entries(EXPECTED).filter(([, a]) => a !== 'public'))('%s -> 403', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    expect((await call(manager, r)).status).toBe(403);
  });
  it('a manager cannot sign in at all', async () => {
    const m = await createOwner(t, { role: 'manager' });
    const res = await new Client(t.app).req('POST', '/api/admin/login', { body: { email: m.email, password: m.password } });
    expect(res.status).toBe(401); expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('CSRF on every state-changing admin endpoint', () => {
  const unsafe = Object.entries(EXPECTED).filter(([k, a]) => !k.startsWith('GET') && a !== 'public');
  it.each(unsafe)('%s: wrong origin -> 403, missing X-Requested-With -> 403, missing/wrong CSRF token -> 403', async (key) => {
    const r = routes().find((x) => x.key === key)!;
    const client = full;
    expect((await call(client, r, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await call(client, r, { origin: null })).status).toBe(403);
    expect((await call(client, r, { xrw: false })).status).toBe(403);
    expect((await call(client, r, { csrf: null })).status).toBe(403);
    expect((await call(client, r, { csrf: 'not-the-token' })).status).toBe(403);
    expect((await call(client, r, { csrf: legacy.csrf })).status).toBe(403);   // a token from another session
  });
  it('login itself needs the dashboard origin and header too (login CSRF)', async () => {
    const body = { email: 'x@example.invalid', password: 'y' };
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body, origin: 'http://evil.example' })).status).toBe(403);
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body, origin: null })).status).toBe(403);
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body, xrw: false })).status).toBe(403);
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body, origin: ORIGIN })).status).toBe(401);
  });
  it('the guarded routes never change anything when refused (a real booking stays untouched through all the refusals above)', async () => {
    const id = await makePending(freshDay());
    for (const what of ['confirm', 'cancel', 'complete', 'no-show']) {
      for (const o of [{ origin: 'http://evil.example' }, { csrf: null }, { xrw: false }]) expect((await full.req('POST', `/api/admin/reservations/${id}/${what}`, { body: {}, ...o })).status).toBe(403);
      expect((await new Client(t.app).req('POST', `/api/admin/reservations/${id}/${what}`, { body: {} })).status).toBe(401);
    }
    const s = await su(); try { expect((await s.query('SELECT status FROM reservations WHERE id = $1', [id])).rows[0].status).toBe('pending'); } finally { await s.end(); }
  });
});
