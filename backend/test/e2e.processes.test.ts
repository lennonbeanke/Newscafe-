// END TO END with the REAL server processes: the public API and the owner API are started as two separate Node processes, each with
// only its own settings, on two real ports. Everything below is plain HTTP, like the website and dashboard will do it.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOwner, makeAdminApp } from './helpers/admin.ts';
import type { TestAdminApp } from './helpers/admin.ts';
import { dateAt, ensureVenue, freshDay, rows, slotAt, testAdminEnv, testPublicEnv } from './helpers/fixtures.ts';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = 21_000 + Math.floor(Math.random() * 3000); const ADM = PUB + 3000;
const procs: ChildProcess[] = []; const out: string[] = [];
const ORIGIN = 'http://localhost:3000';
let helper: TestAdminApp;

function start(entry: string, env: Record<string, string | undefined>): Promise<void> {
  const clean: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const child = spawn(process.execPath, [entry], { cwd: apiDir, env: clean }); procs.push(child);
  child.stdout.on('data', (d) => out.push(String(d))); child.stderr.on('data', (d) => out.push(String(d)));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + out.join(''))), 8000);
    child.stdout.on('data', (d) => { if (String(d).includes('"event":"listening"')) { clearTimeout(t); resolve(); } });
    child.on('exit', () => { clearTimeout(t); reject(new Error('server exited: ' + out.join(''))); });
  });
}
beforeAll(async () => {
  await ensureVenue(); helper = makeAdminApp();
  await start('src/server-public.ts', testPublicEnv({ API_PORT: String(PUB) }));
  await start('src/server-admin.ts', testAdminEnv({ API_ADMIN_PORT: String(ADM) }));
});
afterAll(async () => { for (const p of procs) p.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); await helper.close(); });

class Browser {
  cookie: string | null = null; csrf: string | null = null;
  async call(base: number, method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
    const h: Record<string, string> = { origin: ORIGIN, 'x-requested-with': 'newscafe-admin', ...extra };
    if (this.cookie) h['cookie'] = this.cookie; if (this.csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${base}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) { const m = /^nc_admin_session=([^;]*)/.exec(set); if (m) this.cookie = m[1] ? `nc_admin_session=${m[1]}` : null; }
    const text = await r.text(); const json = text ? JSON.parse(text) : null;
    if (json?.csrf_token) this.csrf = json.csrf_token;
    return { status: r.status, json, headers: r.headers };
  }
}

describe('guest books, owner signs in (e-mail and password only) and manages it - two real processes', () => {
  it('works end to end', async () => {
    const day = freshDay();
    // 1. a guest asks for a table through the PUBLIC process
    const key = 'e2e-key-' + Math.random().toString(36).slice(2, 14) + 'abcdefgh';
    const booked = await fetch(`http://127.0.0.1:${PUB}/api/reservations`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, origin: ORIGIN }, body: JSON.stringify({ party_size: 2, starts_at: slotAt(day, '19:00'), name: 'E2E Guest', email: 'e2e.guest@example.com', consent: true }) });
    expect(booked.status).toBe(201);
    const ref = ((await booked.json()) as { reference: string; status: string }); expect(ref.status).toBe('pending');
    // 2. an owner signs in through the ADMIN process with e-mail and password only: one request, a full session
    const owner = await createOwner(helper);                                    // fake @example.invalid owner
    const b = new Browser();
    expect((await b.call(ADM, 'GET', '/api/admin/reservations')).status).toBe(401);
    const login = await b.call(ADM, 'POST', '/api/admin/login', { email: owner.email, password: owner.password });
    expect(login.status).toBe(200); expect(login.json.signed_in).toBe(true); expect(login.json.stage).toBeUndefined(); expect(login.json.recovery_codes).toBeUndefined();
    expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await b.call(ADM, 'GET', '/api/admin/me')).status).toBe(200);          // signed in straight away
    // the second-factor routes do not exist any more
    for (const gone of ['/api/admin/login/totp', '/api/admin/login/recovery', '/api/admin/totp/enroll/start', '/api/admin/totp/enroll/confirm', '/api/admin/recovery-codes/regenerate']) expect((await b.call(ADM, 'POST', gone, {})).status, gone).toBe(404);
    // 3. the owner finds the guest's booking, confirms it, edits a note, moves it, and the history shows who did what
    const list = await b.call(ADM, 'GET', `/api/admin/reservations?from=${dateAt(day)}&to=${dateAt(day)}&q=E2E%20Guest`);
    expect(list.status).toBe(200); expect(list.json.items).toHaveLength(1);
    const id = list.json.items[0].id as string; expect(list.json.items[0]).toMatchObject({ guest_name: 'E2E Guest', status: 'pending', reference: ref.reference });
    expect((await b.call(ADM, 'POST', `/api/admin/reservations/${id}/confirm`, {})).json.reservation.status).toBe('confirmed');
    expect((await b.call(ADM, 'PATCH', `/api/admin/reservations/${id}`, { notes: 'window seat' })).json.reservation.notes).toBe('window seat');
    expect((await b.call(ADM, 'POST', `/api/admin/reservations/${id}/move`, { starts_at: slotAt(day, '20:00') })).status).toBe(200);
    const hist = await b.call(ADM, 'GET', `/api/admin/reservations/${id}/history`);
    expect(hist.json.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(['created', 'status_changed', 'edited', 'tables_changed']));
    expect(hist.json.items.filter((e: any) => e.actor === owner.id).length).toBeGreaterThanOrEqual(3);
    // 4. the public process shows the guest NOTHING of this, and cannot reach any owner route
    expect((await fetch(`http://127.0.0.1:${PUB}/api/admin/reservations`, { headers: { cookie: b.cookie! } })).status).toBe(404);
    // 5. sign out: the cookie stops working on the server
    const cookie = b.cookie!; const csrf = b.csrf!;
    expect((await b.call(ADM, 'POST', '/api/admin/logout')).status).toBe(204);
    const replay = new Browser(); replay.cookie = cookie; replay.csrf = csrf;
    expect((await replay.call(ADM, 'GET', '/api/admin/me')).status).toBe(401);
    // 6. nothing sensitive reached either process's output
    const log = out.join('');
    for (const s of [owner.password, owner.email, 'e2e.guest@example.com', 'E2E Guest', cookie.split('=')[1]!, csrf, key]) expect(log).not.toContain(s);
    expect((await rows('SELECT 1 FROM audit_logs WHERE actor_id = $1', [owner.id])).length).toBeGreaterThanOrEqual(5);
  });
});
