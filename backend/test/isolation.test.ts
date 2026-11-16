// CREDENTIAL ISOLATION between the public request-handling path and the admin credentials.
//   layer 1 (database): the public login cannot run any admin function or read any admin table, over the very connection the public API uses
//   layer 2 (process):  the public process is started with ONLY public settings; the admin password and keys are not in its environment at all
//   layer 3 (code):     nothing reachable from the public entry point imports the admin or auth modules
//   layer 4 (HTTP):     the public application has no admin routes and the admin application has no public routes
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createOwner, makeAdminApp } from './helpers/admin.ts';
import type { TestAdminApp } from './helpers/admin.ts';
import { bookingBody, ensureVenue, freshDay, get, makeApp, makePending, post, slotAt } from './helpers/fixtures.ts';
import type { TestApp } from './helpers/fixtures.ts';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
let pub: TestApp; let adm: TestAdminApp;
beforeAll(async () => { await ensureVenue(); pub = makeApp(); adm = makeAdminApp(); });
afterAll(async () => { await pub.close(); await adm.close(); });
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'NO ERROR'; } catch (e) { return String((e as { code?: string }).code); } };

describe('layer 1: the public database login (the one the public API really uses) cannot reach admin functionality', () => {
  const NIL = '00000000-0000-4000-8000-000000000000';
  it('every admin function is refused (permission denied) over the public connection', async () => {
    const id = await makePending(freshDay());
    const attempts = [
      `SELECT admin_set_reservation_status('${NIL}', '${id}', 'confirmed', NULL, NULL)`,
      `SELECT admin_create_reservation('${NIL}', 2, now(), 'X', 'x@example.com', NULL, NULL, 'phone', false, NULL, NULL)`,
      `SELECT admin_move_reservation('${NIL}', '${id}', NULL, 3, NULL, NULL, NULL)`,
      `SELECT admin_edit_reservation('${NIL}', '${id}', '{"notes":"x"}', NULL)`,
      `SELECT admin_begin_action('${NIL}')`, `SELECT audit_write('${NIL}', 'x', 'x', 'x', NULL, NULL, NULL)`,
      `SELECT book_reservation('${NIL}', 2, now(), 'X', 'x@example.com', NULL)`, `SELECT public_location()`,
    ];
    for (const sql of attempts) expect(await code(pub.db.query(sql)), sql.slice(0, 40)).toBe('42501');
  });
  it('every admin table and the audit log are unreadable and unwritable over the public connection', async () => {
    for (const tbl of ['admin_users', 'admin_sessions', 'admin_recovery_codes', 'login_attempts', 'audit_logs', 'reservations', 'reservation_events', 'table_allocations', 'dining_tables', 'locations', 'app_environment']) {
      expect(await code(pub.db.query(`SELECT count(*) FROM ${tbl}`)), tbl).toBe('42501');
    }
    expect(await code(pub.db.query(`INSERT INTO audit_logs (action, entity_type) VALUES ('forged', 'x')`))).toBe('42501');
    expect(await code(pub.db.query(`UPDATE admin_users SET is_active = false`))).toBe('42501');
    expect(await code(pub.db.query(`UPDATE reservations SET status = 'confirmed'`))).toBe('42501');
  });
  it('it cannot become the admin role, the definer role or the superuser', async () => {
    for (const sql of ['SET ROLE newscafe_admin', 'SET ROLE newscafe_definer', `SET ROLE ${process.env['TEST_SU_USER']}`, `SET SESSION AUTHORIZATION ${process.env['TEST_SU_USER']}`]) expect(await code(pub.db.query(sql)), sql).toBe('42501');
    expect((await pub.db.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u).toBe('newscafe_public');
  });
  it('and the admin connection cannot run the public booking functions either', async () => {
    expect(await code(adm.db.query(`SELECT public_book_reservation(2, now(), 'X', 'x@example.com', NULL, NULL, true, '0123456789abcdef0123')`))).toBe('42501');
    expect(await code(adm.db.query(`SELECT * FROM public_available_slots(current_date, 2)`))).toBe('42501');
    expect((await adm.db.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u).toBe('newscafe_admin');
  });
});

describe('layer 2: the two processes are configured with disjoint secrets', () => {
  const apiDir = path.resolve(src, '..');
  const read = (f: string): Record<string, string> => Object.fromEntries(readFileSync(path.join(apiDir, f), 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  it('backend/.env.public holds no admin credential or key; backend/.env.admin holds no public credential', () => {
    const p = read('.env.public'); const a = read('.env.admin');
    expect(Object.keys(p).filter((k) => /ADMIN|HMAC|TOTP/.test(k))).toEqual([]);
    expect(Object.keys(a).filter((k) => /PUBLIC|OUTBOX|^API_PORT$|^API_ALLOWED_ORIGIN$/.test(k))).toEqual([]);
    expect(Object.values(p).join('\n')).not.toContain(a['API_DB_ADMIN_PASSWORD']!); expect(Object.values(a).join('\n')).not.toContain(p['API_DB_PUBLIC_PASSWORD']!);
    expect(p['API_DB_PUBLIC_PASSWORD']).not.toBe(a['API_DB_ADMIN_PASSWORD']);
  });
  it('a process started with the public env file really has no admin setting in its environment', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, ['--env-file=.env.public', '-e', "console.log(Object.keys(process.env).filter((k) => /ADMIN|HMAC|TOTP/.test(k)).length)"], { cwd: apiDir, env: { PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' });
    expect(out.trim()).toBe('0');
    const adminOut = execFileSync(process.execPath, ['--env-file=.env.admin', '-e', "console.log(Object.keys(process.env).filter((k) => /PUBLIC|OUTBOX/.test(k)).length)"], { cwd: apiDir, env: { PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' });
    expect(adminOut.trim()).toBe('0');
  });
});

describe('layer 3: nothing reachable from the public entry point can use admin code', () => {
  const graph = (entry: string): Map<string, string> => {
    const seen = new Map<string, string>(); const todo = [path.join(src, entry)];
    while (todo.length) {
      const f = todo.pop()!; if (seen.has(f)) continue;
      const text = readFileSync(f, 'utf8'); seen.set(f, text);
      for (const m of text.matchAll(/from '(\.[^']+)'/g)) todo.push(path.resolve(path.dirname(f), m[1]!));
    }
    return seen;
  };
  it('the public entry point never imports the admin app, the auth modules or the admin schemas', () => {
    const files = [...graph('server-public.ts').keys()].map((f) => path.relative(src, f));
    expect(files.sort()).toEqual(['config.ts', 'db.ts', 'errors.ts', 'logger.ts', 'public-app.ts', 'rate-limit.ts', 'schemas.ts', 'server-public.ts', 'services.ts']);
    for (const f of files) expect(f).not.toMatch(/admin|auth\//);
  });
  it('...and none of those modules (other than the shared config loader) mention an admin credential, key or admin function', () => {
    for (const [f, text] of graph('server-public.ts')) {
      if (path.basename(f) === 'config.ts') continue;
      expect(text, path.relative(src, f)).not.toMatch(/newscafe_admin|API_DB_ADMIN|hmacKey|totpKey|AdminConfig|loadAdminConfig|admin_set_reservation|admin_create|admin_move|admin_edit|admin_users|audit_logs/);
    }
  });
  it('the public entry point loads only the public configuration', () => {
    const entry = readFileSync(path.join(src, 'server-public.ts'), 'utf8');
    expect(entry).toContain('loadPublicConfig'); expect(entry).not.toContain('loadAdminConfig');
  });
  it('the admin entry point never imports the public application, the public services or the outbox', () => {
    const files = [...graph('server-admin.ts').keys()].map((f) => path.relative(src, f));
    for (const f of files) expect(f).not.toMatch(/public-app|services\.ts|outbox/);
    for (const [f, text] of graph('server-admin.ts')) { if (path.basename(f) === 'config.ts') continue; expect(text, f).not.toMatch(/newscafe_public|API_DB_PUBLIC|public_book_reservation|public_available_slots/); }
    expect(readFileSync(path.join(src, 'server-admin.ts'), 'utf8')).not.toContain('loadPublicConfig');
  });
});

describe('layer 4: each application serves only its own routes', () => {
  it('the public application answers 404 for every admin path, ignores admin cookies and never sets a cookie', async () => {
    const o = await createOwner(adm); const c = new Client(adm.app); await c.signIn(o);
    for (const p of ['/api/admin/me', '/api/admin/reservations', '/api/admin/login', '/api/admin/audit-log', '/api/admin/tables']) {
      const r = await pub.app.request(p, { headers: { cookie: c.cookie!, origin: 'http://localhost:3000', 'x-test-client': 'iso' } });
      expect(r.status, p).toBe(404); expect(r.headers.get('set-cookie')).toBeNull();
    }
    const booking = await post(pub.app, bookingBody({}, freshDay()), { cookie: c.cookie! });
    expect(booking.status).toBe(201); expect(booking.headers.get('set-cookie')).toBeNull();
    expect((await get(pub.app, '/api/health', { cookie: c.cookie! })).headers.get('set-cookie')).toBeNull();
  });
  it('the admin application answers 404 for every public path', async () => {
    for (const p of ['/api/health', '/api/availability?date=2030-01-01&party=2', '/api/reservations']) {
      const r = await adm.app.request(p, { method: p === '/api/reservations' ? 'POST' : 'GET', headers: { origin: 'http://localhost:3000', 'x-requested-with': 'newscafe-admin', 'content-type': 'application/json', 'idempotency-key': 'a'.repeat(20) }, body: p === '/api/reservations' ? JSON.stringify(bookingBody({}, 1)) : undefined });
      expect(r.status, p).toBe(404);
    }
  });
  it('a booking made through the public application is only visible to the owner through the admin application', async () => {
    const day = freshDay();
    const key = 'iso-visible-' + Math.random().toString(36).slice(2, 12) + 'xxxxxxxx';
    const made = await post(pub.app, bookingBody({ name: 'Visible Only To Owner' }, day), {}, key);
    expect(made.status).toBe(201);
    expect(JSON.stringify(await made.json())).not.toContain('Visible Only To Owner');
    const o = await createOwner(adm); const c = new Client(adm.app); await c.signIn(o);
    const list = (await (await c.req('GET', `/api/admin/reservations?from=${slotAt(day, '19:00').slice(0, 10)}&to=${slotAt(day, '19:00').slice(0, 10)}&q=Visible%20Only`)).json()) as { items: { guest_name: string }[] };
    expect(list.items.map((i) => i.guest_name)).toEqual(['Visible Only To Owner']);
  });
});
