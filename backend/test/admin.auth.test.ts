// Owner sign-in with E-MAIL AND PASSWORD ONLY: Argon2id, one-step full session, lockout, rate limits, sessions, logout, CSRF, audit.
// (The owner chose to run without two-factor: see docs/SECURITY.md. The authenticator and recovery-code routes no longer exist.)
// Real PostgreSQL (throw-away test database), real newscafe_admin login, fake @example.invalid owners only.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csrfFor } from '../src/auth/session.ts';
import { auditFor, Client, createOwner, legacyPendingSession, makeAdminApp, ORIGIN, sessionRows, userRow, WEAK_ARGON2 } from './helpers/admin.ts';
import type { TestAdminApp } from './helpers/admin.ts';
import { ensureVenue, rows, su } from './helpers/fixtures.ts';

let t: TestAdminApp;
beforeAll(async () => { await ensureVenue(); t = makeAdminApp(); });
afterAll(async () => { await t.close(); });
const body = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const stripId = (b: Record<string, unknown>): Record<string, unknown> => { const { request_id: _r, ...rest } = b; return rest; };
const sql = async (q: string, p: unknown[] = []): Promise<void> => { const c = await su(); try { await c.query(q, p); } finally { await c.end(); } };
const wrongPassword = (c: Client, o: { email: string }) => c.req('POST', '/api/admin/login', { body: { email: o.email, password: 'definitely-not-the-password' } });

describe('sign-in with e-mail and password only', () => {
  it('a correct password gives a FULL session at once: no second step, nothing pending', async () => {
    const o = await createOwner(t); const c = new Client(t.app);
    const r = await c.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
    expect(r.status).toBe(200);
    const b = await body(r);
    expect(b['signed_in']).toBe(true); expect(b['user']).toEqual({ email: o.email, role: 'owner' }); expect(typeof b['csrf_token']).toBe('string');
    expect(Object.keys(b).sort()).toEqual(['csrf_token', 'session_expires_at', 'signed_in', 'user']);   // no stage, no recovery codes, no secret
    expect(Date.parse(String(b['session_expires_at']))).toBeGreaterThan(Date.now() + 11.9 * 3600_000);
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);                                       // signed in straight away
    expect((await c.req('GET', '/api/admin/reservations')).status).toBe(200);
    const sessions = await sessionRows(o.id);
    expect(sessions).toHaveLength(1); expect(sessions[0]!.mfa_pending).toBe(false); expect(sessions[0]!.revoked_at).toBeNull();
    const [exp] = await rows<{ secs: number }>('SELECT extract(epoch FROM expires_at - created_at)::int AS secs FROM admin_sessions WHERE user_id = $1', [o.id]);
    expect(exp?.secs).toBe(43200);
    const me = await body(await c.req('GET', '/api/admin/me'));
    expect(me['user']).toEqual({ email: o.email, role: 'owner' }); expect(me['csrf_token']).toBe(b['csrf_token']); expect(me['idle_timeout_seconds']).toBe(1800);
  });
  it('the sign-in is recorded: last sign-in time, an audit row, counters reset', async () => {
    const o = await createOwner(t);
    await wrongPassword(new Client(t.app), o);
    expect((await userRow(o.id)).failed_logins).toBe(1); expect((await userRow(o.id)).last_login_at).toBeNull();
    expect((await new Client(t.app).signIn(o)).status).toBe(200);
    const u = await userRow(o.id);
    expect(u.failed_logins).toBe(0); expect(u.locked_until).toBeNull(); expect(u.last_login_at).not.toBeNull();
    const a = await auditFor(o.id, 'auth.login');
    expect(a).toHaveLength(1); expect(a[0]!.after).toEqual({ method: 'password' });
    expect(await auditFor(o.id, 'auth.password_ok')).toHaveLength(0);                                    // the old half-way event is never written any more
  });
  it('the session cookie is HttpOnly, SameSite=Strict, scoped to the admin path, lasts 12 hours; only a hash of the token is stored', async () => {
    const o = await createOwner(t); const c = new Client(t.app);
    const a = await c.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
    const set = a.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^nc_admin_session=[A-Za-z0-9_-]{43}; Path=\/api\/admin; Max-Age=43200; HttpOnly; SameSite=Strict$/);
    const token = /nc_admin_session=([^;]+)/.exec(set)![1]!;
    const stored = await rows<{ all: string }>('SELECT s::text AS all FROM admin_sessions s WHERE user_id = $1', [o.id]);
    expect(stored.map((r) => r.all).join()).not.toContain(token);
    expect((await sessionRows(o.id)).map((s) => s.token_hash.toString('hex'))).toContain(createHash('sha256').update(token).digest('hex'));
  });
  it('every sign-in gets a brand-new random token; a cookie sent along with the login is never reused (no session fixation)', async () => {
    const o = await createOwner(t); const c = new Client(t.app);
    expect((await c.signIn(o)).status).toBe(200); const first = c.cookie;
    const attacker = 'nc_admin_session=' + 'A'.repeat(43);
    const again = new Client(t.app); again.cookie = attacker;
    const r = await again.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
    expect(r.status).toBe(200); expect(again.cookie).not.toBe(attacker); expect(again.cookie).not.toBe(first);
    const stale = new Client(t.app); stale.cookie = attacker; stale.csrf = 'x';
    expect((await stale.req('GET', '/api/admin/me')).status).toBe(401);                                    // the planted cookie never became a session
  });
  it('an owner who once set up an authenticator signs in with the password alone (leftover data is ignored, not asked for)', async () => {
    const o = await createOwner(t);
    await sql(`UPDATE admin_users SET totp_secret_encrypted = '\\x0102', totp_confirmed_at = now(), totp_last_step = 5 WHERE id = $1`, [o.id]);
    await sql(`INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES ($1, '\\x0a0b'::bytea)`, [o.id]);
    const c = new Client(t.app); const r = await c.signIn(o);
    expect(r.status).toBe(200); expect((await body(r))['signed_in']).toBe(true);
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);
    const u = await rows<{ totp_last_step: string | null; used: number }>('SELECT totp_last_step, (SELECT count(*)::int FROM admin_recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL) AS used FROM admin_users WHERE id = $1', [o.id]);
    expect(u[0]!.totp_last_step).toBe('5'); expect(u[0]!.used).toBe(0);                                  // nothing of the old data is touched
  });
  it('a half-finished session from the OLD two-step login stays useless, and a normal sign-in next to it works', async () => {
    const o = await createOwner(t); const old = await legacyPendingSession(t, o);
    const stale = new Client(t.app); stale.cookie = old.cookie; stale.csrf = old.csrf;
    expect((await stale.req('GET', '/api/admin/me')).status).toBe(401);
    expect((await stale.req('GET', '/api/admin/reservations')).status).toBe(401);
    const c = new Client(t.app); expect((await c.signIn(o)).status).toBe(200);
    expect((await stale.req('GET', '/api/admin/me')).status).toBe(401);                                    // still dead
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);
  });
  it('a wrong password is 401 and counts toward the lock-out; the right one still works afterwards', async () => {
    const o = await createOwner(t);
    const wrong = await wrongPassword(new Client(t.app), o);
    expect(wrong.status).toBe(401); expect(stripId(await body(wrong))['error']).toBe('invalid_credentials'); expect(wrong.headers.get('set-cookie')).toBeNull();
    expect((await userRow(o.id)).failed_logins).toBe(1);
    expect((await new Client(t.app).signIn(o)).status).toBe(200);
  });
});

describe('invalid credentials all look the same (no way to learn which owners exist)', () => {
  it('unknown e-mail, wrong password, manager, deactivated and locked accounts: identical 401', async () => {
    const real = await createOwner(t);
    const mgr = await createOwner(t, { role: 'manager' });
    const off = await createOwner(t, { active: false });
    const lockedOwner = await createOwner(t);
    await sql(`UPDATE admin_users SET locked_until = now() + interval '10 minutes' WHERE id = $1`, [lockedOwner.id]);
    const attempts: [string, string][] = [
      ['nobody-here@example.invalid', 'x'.repeat(16)], [real.email, 'wrong-password-xxxx'], [mgr.email, mgr.password], [off.email, off.password], [lockedOwner.email, lockedOwner.password],
    ];
    const answers: Record<string, unknown>[] = [];
    for (const [email, password] of attempts) {
      const r = await new Client(t.app).req('POST', '/api/admin/login', { body: { email, password } });
      expect(r.status).toBe(401); expect(r.headers.get('set-cookie')).toBeNull();
      answers.push(stripId(await body(r)));
    }
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(answers[0]).toEqual({ error: 'invalid_credentials', message: 'The e-mail address or password is not correct.' });
    expect(await sessionRows(mgr.id)).toHaveLength(0); expect(await sessionRows(off.id)).toHaveLength(0); expect(await sessionRows(lockedOwner.id)).toHaveLength(0);
  });
  it('failures are recorded for the owner: hashed attempt keys only (no e-mail, no address), audit rows without personal data', async () => {
    const o = await createOwner(t); const c = new Client(t.app);
    await wrongPassword(c, o);
    const attempts = await rows<{ key_hash: string; success: boolean }>(`SELECT key_hash, success FROM login_attempts ORDER BY id DESC LIMIT 1`);
    expect(attempts[0]).toMatchObject({ success: false }); expect(attempts[0]!.key_hash).toMatch(/^[0-9a-f]{64}$/);
    const a = await auditFor(o.id, 'auth.login_failed');
    expect(a).toHaveLength(1); expect(a[0]!.after).toEqual({ reason: 'bad_password' }); expect(a[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(a)).not.toContain(o.email); expect(JSON.stringify(a)).not.toContain(c.id);
  });
  it.each([
    ['missing password', { email: 'a@example.invalid' }], ['missing e-mail', { password: 'x' }], ['not an e-mail', { email: 'nope', password: 'x' }],
    ['empty password', { email: 'a@example.invalid', password: '' }], ['129-character password', { email: 'a@example.invalid', password: 'x'.repeat(129) }],
    ['extra field', { email: 'a@example.invalid', password: 'x', role: 'owner' }], ['password as number', { email: 'a@example.invalid', password: 12345 }],
  ])('rejects %s with 422 (before any password work)', async (_n, b) => {
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body: b })).status).toBe(422);
  });
  it('hostile e-mail text is just data', async () => {
    const r = await new Client(t.app).req('POST', '/api/admin/login', { body: { email: "x'--@example.invalid", password: "' OR '1'='1" } });
    expect(r.status).toBe(401);
  });
  it('an old weaker password hash is upgraded to the current Argon2id settings at the next successful sign-in', async () => {
    const strong = makeAdminApp({}, { argon2: { memoryCost: 16384, timeCost: 2, parallelism: 1 } });
    try {
      const o = await createOwner(strong);
      expect((await userRow(o.id)).password_hash).toContain(`m=${WEAK_ARGON2.memoryCost},t=${WEAK_ARGON2.timeCost}`);
      const c = new Client(strong.app);
      expect((await c.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } })).status).toBe(200);
      expect((await userRow(o.id)).password_hash).toMatch(/^\$argon2id\$v=19\$m=16384,t=2,p=1\$/);
      const c2 = new Client(strong.app);
      expect((await c2.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } })).status).toBe(200);   // still works after the upgrade
    } finally { await strong.close(); }
  });
});

describe('lockout', () => {
  it('5 wrong passwords lock the account for 15 minutes; even the right password is then refused with the same generic answer', async () => {
    const o = await createOwner(t);
    for (let i = 1; i <= 4; i++) { expect((await wrongPassword(new Client(t.app), o)).status).toBe(401); expect((await userRow(o.id)).locked_until).toBeNull(); }
    await wrongPassword(new Client(t.app), o);
    const u = await userRow(o.id);
    expect(u.failed_logins).toBe(5); expect(u.locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000); expect(u.locked_until!.getTime()).toBeLessThan(Date.now() + 16 * 60_000);
    const good = await new Client(t.app).req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
    expect(good.status).toBe(401); expect(stripId(await body(good))['error']).toBe('invalid_credentials');
    expect((await userRow(o.id)).failed_logins).toBe(5);                                  // attempts while locked do not extend the lock
    expect((await auditFor(o.id, 'auth.locked')).length).toBe(1);
  });
  it('after the lock expires the owner can sign in again and the counters reset', async () => {
    const o = await createOwner(t);
    for (let i = 0; i < 5; i++) await wrongPassword(new Client(t.app), o);
    await sql(`UPDATE admin_users SET locked_until = now() - interval '1 second' WHERE id = $1`, [o.id]);
    const c = new Client(t.app);
    expect((await c.signIn(o)).status).toBe(200);
    const u = await userRow(o.id); expect(u.failed_logins).toBe(0); expect(u.locked_until).toBeNull();
  });
  it('after a lock expires, the next failure counts as the first, not the sixth', async () => {
    const o = await createOwner(t);
    for (let i = 0; i < 5; i++) await wrongPassword(new Client(t.app), o);
    await sql(`UPDATE admin_users SET locked_until = now() - interval '1 second' WHERE id = $1`, [o.id]);
    await wrongPassword(new Client(t.app), o);
    const u = await userRow(o.id); expect(u.failed_logins).toBe(1); expect(u.locked_until).toBeNull();
  });
  it('a correct password resets the failure counter, so earlier typos never add up to a lock-out', async () => {
    const o = await createOwner(t);
    for (let i = 0; i < 4; i++) await wrongPassword(new Client(t.app), o);
    expect((await userRow(o.id)).failed_logins).toBe(4);
    expect((await new Client(t.app).signIn(o)).status).toBe(200);
    expect((await userRow(o.id)).failed_logins).toBe(0);
    for (let i = 0; i < 4; i++) await wrongPassword(new Client(t.app), o);
    expect((await userRow(o.id)).locked_until).toBeNull();                                                // 4 + 4 failures with a success in between: not locked
  });
  it('locking an account ends nothing that is already running, but nobody new can sign in until it expires', async () => {
    const o = await createOwner(t);
    const inside = new Client(t.app); expect((await inside.signIn(o)).status).toBe(200);
    for (let i = 0; i < 5; i++) await wrongPassword(new Client(t.app), o);
    expect((await userRow(o.id)).locked_until).not.toBeNull();
    expect((await new Client(t.app).signIn(o)).status).toBe(401);
  });
  it('repeated attempts for one e-mail from one place are refused (429) after 10 failures even for an address that does not exist', async () => {
    const c = new Client(t.app); const email = 'ghost-owner@example.invalid';
    for (let i = 0; i < 10; i++) expect((await c.req('POST', '/api/admin/login', { body: { email, password: 'x'.repeat(14) } })).status).toBe(401);
    const r = await c.req('POST', '/api/admin/login', { body: { email, password: 'x'.repeat(14) } });
    expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('900');
  });
  it('one client is limited to 30 sign-in attempts per 15 minutes (before any password work)', async () => {
    const c = new Client(t.app);
    for (let i = 0; i < 30; i++) expect((await c.req('POST', '/api/admin/login', { body: {} })).status).toBe(422);
    const r = await c.req('POST', '/api/admin/login', { body: {} });
    expect(r.status).toBe(429); expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await new Client(t.app).req('POST', '/api/admin/login', { body: {} })).status).toBe(422);   // other clients unaffected
  });
});

describe('sessions: expiry, revocation, logout', () => {
  const fullSession = async () => { const o = await createOwner(t); const c = new Client(t.app); await c.signIn(o); return { o, c }; };
  it('ends after 30 minutes without a request (idle timeout), and the dead cookie is cleared', async () => {
    const { o, c } = await fullSession();
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);
    await sql(`UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = $1 AND NOT mfa_pending`, [o.id]);
    const cookieBefore = c.cookie;
    const r = await c.req('GET', '/api/admin/me');
    expect(r.status).toBe(401); expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/); expect(cookieBefore).not.toBeNull();
  });
  it('an active session stays alive: the idle clock moves forward while it is used', async () => {
    const { o, c } = await fullSession();
    await sql(`UPDATE admin_sessions SET last_seen_at = now() - interval '20 minutes' WHERE user_id = $1 AND NOT mfa_pending`, [o.id]);
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);
    const [r] = await rows<{ ago: number }>(`SELECT extract(epoch FROM now() - last_seen_at)::int AS ago FROM admin_sessions WHERE user_id = $1 AND NOT mfa_pending`, [o.id]);
    expect(r!.ago).toBeLessThan(5);
  });
  it('never lasts longer than 12 hours in total, however busy', async () => {
    const { o, c } = await fullSession();
    const [r] = await rows<{ secs: number }>('SELECT extract(epoch FROM expires_at - created_at)::int AS secs FROM admin_sessions WHERE user_id = $1 AND NOT mfa_pending', [o.id]);
    expect(r!.secs).toBe(43200);
    await sql(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND NOT mfa_pending`, [o.id]);
    expect((await c.req('GET', '/api/admin/me')).status).toBe(401);
  });
  it('logout revokes the session on the SERVER: replaying the old cookie fails', async () => {
    const { o, c } = await fullSession(); const oldCookie = c.cookie; const oldCsrf = c.csrf;
    const r = await c.req('POST', '/api/admin/logout');
    expect(r.status).toBe(204); expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    const replay = new Client(t.app); replay.cookie = oldCookie; replay.csrf = oldCsrf;
    expect((await replay.req('GET', '/api/admin/me')).status).toBe(401);
    expect((await sessionRows(o.id)).filter((s) => !s.mfa_pending)[0]!.revoked_at).not.toBeNull();
    expect((await auditFor(o.id, 'auth.logout')).length).toBe(1);
  });
  it('a revoked, deactivated or demoted owner loses access immediately', async () => {
    const a = await fullSession(); await sql('UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1', [a.o.id]);
    expect((await a.c.req('GET', '/api/admin/me')).status).toBe(401);
    const b = await fullSession(); await sql('UPDATE admin_users SET is_active = false WHERE id = $1', [b.o.id]);
    expect((await b.c.req('GET', '/api/admin/me')).status).toBe(401);
    const c = await fullSession(); await sql(`UPDATE admin_users SET role = 'manager' WHERE id = $1`, [c.o.id]);
    expect((await c.c.req('GET', '/api/admin/me')).status).toBe(403);
  });
  it.each([
    ['no cookie', undefined], ['random well-formed token', 'nc_admin_session=' + 'A'.repeat(43)], ['too short', 'nc_admin_session=abc'],
    ['SQL injection', "nc_admin_session=' OR '1'='1"], ['wrong cookie name', 'session=' + 'A'.repeat(43)], ['two cookies, junk first', 'x=1; nc_admin_session=!!!!'],
  ])('a forged or malformed cookie (%s) is refused', async (_n, cookie) => {
    const c = new Client(t.app);
    const r = await c.req('GET', '/api/admin/me', { headers: cookie ? { cookie } : {}, noCookie: true });
    expect(r.status).toBe(401); expect(JSON.stringify(await body(r))).not.toMatch(/SELECT|admin_sessions|token/i);
  });
  it('two separate sign-ins have separate sessions; logging one out does not end the other', async () => {
    const o = await createOwner(t);
    const a = new Client(t.app); const b = new Client(t.app);
    expect((await a.signIn(o)).status).toBe(200); expect((await b.signIn(o)).status).toBe(200);
    expect((await a.req('POST', '/api/admin/logout')).status).toBe(204);
    expect((await b.req('GET', '/api/admin/me')).status).toBe(200);
  });
});

describe('CSRF protection (three independent layers)', () => {
  const signed = async () => { const o = await createOwner(t); const c = new Client(t.app); await c.signIn(o); return { o, c }; };
  it('login and every state-changing request must come from the dashboard origin', async () => {
    const { c } = await signed();
    for (const origin of ['http://evil.example', 'http://localhost:3001', 'https://localhost:3000', 'null', 'http://localhost:3000.evil.example']) {
      const r = await c.req('POST', '/api/admin/logout', { origin }); expect(r.status, origin).toBe(403); expect((await body(r))['error']).toBe('csrf_origin');
    }
    expect((await c.req('POST', '/api/admin/logout', { origin: null })).status).toBe(403);            // no Origin header at all
    expect((await new Client(t.app).req('POST', '/api/admin/login', { origin: 'http://evil.example', body: { email: 'a@example.invalid', password: 'x' } })).status).toBe(403);   // login CSRF
  });
  it('the X-Requested-With header is required (it forces a CORS pre-flight for any other site)', async () => {
    const { c } = await signed();
    const r = await c.req('POST', '/api/admin/logout', { xrw: false }); expect(r.status).toBe(403); expect((await body(r))['error']).toBe('csrf_header');
    expect((await c.req('POST', '/api/admin/logout', { headers: { 'x-requested-with': 'XMLHttpRequest' }, xrw: false })).status).toBe(403);
  });
  it('the per-session CSRF token is required, and a token from another session is refused', async () => {
    const { c } = await signed(); const other = await signed();
    for (const token of [null, '', 'wrong', other.c.csrf!, csrfFor(t.config.hmacKey, 'A'.repeat(43))]) {
      const r = await c.req('POST', '/api/admin/logout', { csrf: token }); expect(r.status, String(token)).toBe(403); expect((await body(r))['error']).toBe('csrf_token');
    }
    expect((await c.req('POST', '/api/admin/logout')).status).toBe(204);                               // the right token works
  });
  it('safe requests (GET) need no CSRF token, so the dashboard can read freely', async () => {
    const { c } = await signed();
    expect((await c.req('GET', '/api/admin/me', { csrf: null, origin: null, xrw: false })).status).toBe(200);
  });
  it('browser pre-flight: only the dashboard origin, with credentials; no other origin is ever echoed', async () => {
    const c = new Client(t.app);
    const ok = await c.req('OPTIONS', '/api/admin/reservations/x/cancel', { origin: ORIGIN, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-csrf-token,x-requested-with' }, xrw: false, noCookie: true });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN); expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await c.req('OPTIONS', '/api/admin/login', { origin: 'https://evil.example', headers: { 'access-control-request-method': 'POST' }, xrw: false, noCookie: true });
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });
});

describe('secrets and personal data never leak', () => {
  it('no response and no log line contains a password, hash, session token, CSRF token, key, e-mail or address', async () => {
    const x = makeAdminApp(); const o = await createOwner(x);
    try {
      const responses: string[] = [];
      const grab = async (r: Response) => { responses.push(await r.clone().text()); return r; };
      const c = new Client(x.app);
      await grab(await c.req('POST', '/api/admin/login', { body: { email: o.email, password: 'wrong-password-xx' } }));
      await grab(await c.req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } }));
      const cookieAfter = c.cookie!; const csrfAfter = c.csrf!;
      await grab(await c.req('GET', '/api/admin/me'));
      await grab(await c.req('GET', '/api/admin/reservations'));
      await grab(await c.req('POST', '/api/admin/logout'));
      const logs = x.logs.join('\n');
      const secretsToHide = [o.password, cookieAfter.split('=')[1]!, csrfAfter, o.email, c.id, (await userRow(o.id)).password_hash, x.config.dbPassword, x.config.hmacKey.toString('hex')];
      for (const s of secretsToHide) expect(logs, `log contains "${s.slice(0, 10)}…"`).not.toContain(s);
      const noisy = responses.join('\n');
      for (const s of [o.password, (await userRow(o.id)).password_hash, '$argon2', 'token_hash', x.config.dbPassword]) expect(noisy).not.toContain(s);
      expect(logs).not.toMatch(/password|cookie|authorization|argon2/i);
      const allowed = new Set(['t', 'level', 'event', 'request_id', 'method', 'route', 'status', 'duration_ms', 'code', 'error_class', 'outcome', 'reason', 'booking', 'cache', 'count', 'port', 'env', 'pool', 'problems', 'signal']);
      for (const line of x.logs) for (const k of Object.keys(JSON.parse(line) as object)) expect(allowed.has(k), `unexpected log field ${k}`).toBe(true);
      expect(x.logs.length).toBeGreaterThan(4);
    } finally { await x.close(); }
  });
  it('audit rows hold ids, actions and hashed addresses only, never e-mails or passwords', async () => {
    const o = await createOwner(t); const c = new Client(t.app);
    await wrongPassword(c, o); await c.signIn(o); await c.req('POST', '/api/admin/logout');
    const a = await auditFor(o.id);
    expect(a.map((r) => r.action)).toEqual(expect.arrayContaining(['auth.login_failed', 'auth.login', 'auth.logout']));
    const text = JSON.stringify(a);
    for (const s of [o.email, o.password, c.id]) expect(text).not.toContain(s);
    expect(a.every((r) => r.ip_hash === null || /^[0-9a-f]{32}$/.test(r.ip_hash))).toBe(true);
  });
});
