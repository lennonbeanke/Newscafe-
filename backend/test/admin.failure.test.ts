// Owner API when the database misbehaves. There is no "request mode" for the owner: it fails CLOSED (503), never guesses, never
// signs anyone in or out by mistake, and a change whose outcome is unknown is reported as unknown (never as done or as failed).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FaultProxy } from './helpers/proxy.ts';
import { Client, createOwner, makeAdminApp } from './helpers/admin.ts';
import type { TestAdminApp, TestOwner } from './helpers/admin.ts';
import { ensureVenue, freshDay, makePending, rows } from './helpers/fixtures.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const FAST = { dbConnectTimeoutMs: 600, dbQueryTimeoutMs: 800, dbCooldownMs: 150 };
let proxy: FaultProxy; let t: TestAdminApp; let owner: TestOwner; let c: Client;
beforeAll(async () => {
  await ensureVenue();
  proxy = new FaultProxy(Number(process.env['API_DB_PORT'])); await proxy.start();
  t = makeAdminApp({ API_DB_PORT: String(proxy.port) }, FAST);
  owner = await createOwner(t); c = new Client(t.app);
  expect((await c.signIn(owner)).status).toBe(200);
});
afterAll(async () => { await proxy.setMode('pass'); await t.close(); await proxy.stop(); });
afterEach(async () => { await proxy.setMode('pass'); await sleep(300); });
const j = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const status = async (id: string): Promise<string> => (await rows<{ status: string }>('SELECT status FROM reservations WHERE id = $1', [id]))[0]!.status;

describe('database unreachable', () => {
  it('reads and writes answer 503 service_unavailable; nothing leaks; the session is NOT destroyed; it works again afterwards', async () => {
    const id = await makePending(freshDay());
    await proxy.setMode('refuse'); await sleep(100);
    const list = await c.req('GET', '/api/admin/reservations');
    expect(list.status).toBe(503); expect((await j(list))['error']).toBe('service_unavailable');
    expect(list.headers.get('set-cookie')).toBeNull();                                       // an outage must not look like "you were signed out"
    await sleep(250);
    const write = await c.req('POST', `/api/admin/reservations/${id}/confirm`, { body: {} });
    expect(write.status).toBe(503); expect(JSON.stringify(await j(write))).not.toMatch(/ECONN|127\.0\.0\.1|SELECT|newscafe_|postgres/i);
    expect(await status(id)).toBe('pending');
    await proxy.setMode('pass'); await sleep(400);
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);                          // same cookie, same session
    expect((await c.req('POST', `/api/admin/reservations/${id}/confirm`, { body: {} })).status).toBe(200);
  });
  it('sign-in fails with 503 (not 401): an outage is never reported as "wrong password" and never counts as a failed attempt', async () => {
    const o = await createOwner(t);
    await proxy.setMode('refuse'); await sleep(100);
    const r = await new Client(t.app).req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
    expect(r.status).toBe(503); expect((await j(r))['error']).toBe('service_unavailable');
    const u = await rows<{ failed_logins: number }>('SELECT failed_logins FROM admin_users WHERE id = $1', [o.id]);
    expect(u[0]!.failed_logins).toBe(0);
  });
  it('a hung database ends within a few seconds as 503, with nothing changed', async () => {
    const id = await makePending(freshDay());
    await proxy.setMode('blackhole'); await sleep(50);
    const started = Date.now();
    const r = await c.req('POST', `/api/admin/reservations/${id}/confirm`, { body: {} });
    expect(Date.now() - started).toBeLessThan(5000); expect(r.status).toBe(503);
    expect(await status(id)).toBe('pending');
  });
});

describe('the answer is lost after the database saved the change (outcome unknown)', () => {
  it('says "outcome unknown", the change IS in the database exactly once, and the follow-up shows the truth', async () => {
    const id = await makePending(freshDay()); await c.req('POST', `/api/admin/reservations/${id}/confirm`, { body: {} });
    expect((await c.req('GET', '/api/admin/me')).status).toBe(200);                          // warm a pooled connection
    proxy.armDrop('admin_set_reservation_status');                                           // the session check is answered; the cancel itself runs, but its reply is lost
    const r = await c.req('POST', `/api/admin/reservations/${id}/cancel`, { body: { reason: 'lost reply' } });
    expect(r.status).toBe(503); expect((await j(r))['error']).toBe('outcome_unknown');
    expect(await status(id)).toBe('cancelled');                                              // it DID commit
    expect(await rows(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.status' AND after->>'status' = 'cancelled'`, [id])).toHaveLength(1);
    await proxy.setMode('pass'); await sleep(400);
    expect(await j(await c.req('GET', `/api/admin/reservations/${id}`))).toMatchObject({ reservation: { status: 'cancelled' } });
    const again = await c.req('POST', `/api/admin/reservations/${id}/cancel`, { body: {} });   // a blind retry is refused, not applied twice
    expect(again.status).toBe(409); expect((await j(again))['error']).toBe('status_change_not_allowed');
    expect(await rows(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'reservation.status' AND after->>'status' = 'cancelled'`, [id])).toHaveLength(1);
  });
});

describe('wrong environment label', () => {
  it('against a database that is not the development database the admin API refuses everything and sends no statement', async () => {
    const x = makeAdminApp({ API_DB_NAME: process.env['TEST_PROD_DB'] }, FAST);
    try {
      const r = await new Client(x.app).req('POST', '/api/admin/login', { body: { email: `${randomUUID()}@example.invalid`, password: 'x'.repeat(14) } });
      expect(r.status).toBe(503);
      expect(x.db.stats.queries).toBe(0);
      expect(x.logs.join('\n')).toContain('db_environment_refused');
    } finally { await x.close(); }
  });
});

describe('failures leave no personal data or secrets in the logs', () => {
  it('error logs name the failure class only', async () => {
    const x = makeAdminApp({ API_DB_PORT: String(proxy.port) }, FAST); const o = await createOwner(x);
    try {
      await proxy.setMode('refuse'); await sleep(100);
      await new Client(x.app).req('POST', '/api/admin/login', { body: { email: o.email, password: o.password } });
      const text = x.logs.join('\n');
      expect(text).toContain('request_failed');
      for (const s of [o.email, o.password, 'ECONNREFUSED', '127.0.0.1', x.config.dbPassword, x.config.hmacKey.toString('hex')]) expect(text).not.toContain(s);
    } finally { await x.close(); }
  });
});
