// Failure handling. The hard rule: if the database cannot be reached, the API NEVER says a booking is saved, it says
// "request only" (fallback: "request") and the website switches to the request-a-booking flow.
// A fault-injecting TCP proxy sits between the API and PostgreSQL to make the database vanish in realistic ways.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FaultProxy } from './helpers/proxy.ts';
import { bookingBody, dateAt, ensureVenue, freshDay, get, makeApp, post, rows } from './helpers/fixtures.ts';
import type { TestApp } from './helpers/fixtures.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const countKey = async (key: string): Promise<number> => (await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).length;

let proxy: FaultProxy; let t: TestApp;
const FAST = { dbConnectTimeoutMs: 600, dbQueryTimeoutMs: 800, dbCooldownMs: 150, healthOkTtlMs: 60, healthDownTtlMs: 60 };

beforeAll(async () => {
  await ensureVenue();
  proxy = new FaultProxy(Number(process.env['API_DB_PORT']));
  await proxy.start();
  t = makeApp({ API_DB_PORT: String(proxy.port) }, FAST);
});
afterAll(async () => { await proxy.setMode('pass'); await t.close(); await proxy.stop(); });
afterEach(async () => { await proxy.setMode('pass'); await sleep(250); });   // let the cooldown pass between scenarios

describe('database unreachable (nobody listening)', () => {
  it('booking: 503 with fallback "request", nothing saved, never a 201', async () => {
    expect((await post(t.app, bookingBody())).status).toBe(201);                  // warm: working normally
    await proxy.setMode('refuse'); await sleep(100);
    const key = randomUUID();
    const r = await post(t.app, bookingBody(), {}, key);
    expect(r.status).toBe(503);
    const b = await json(r);
    expect(b['error']).toBe('booking_unavailable'); expect(b['fallback']).toBe('request');
    expect(await countKey(key)).toBe(0);
  });
  it('availability: 503 with fallback "request"', async () => {
    await proxy.setMode('refuse'); await sleep(100);
    const r = await get(t.app, `/api/availability?date=${dateAt(freshDay())}&party=2`);
    expect(r.status).toBe(503); expect((await json(r))['fallback']).toBe('request');
  });
  it('health says request_only and still exposes nothing else; it recovers by itself when the database returns', async () => {
    await proxy.setMode('refuse'); await sleep(100);
    const down = await get(t.app, '/api/health');
    expect(down.status).toBe(200); expect(await down.json()).toEqual({ status: 'ok', booking: 'request_only' });
    await proxy.setMode('pass'); await sleep(300);
    expect(await (await get(t.app, '/api/health')).json()).toEqual({ status: 'ok', booking: 'available' });
  });
  it('contact details configured for the fallback are included in the 503', async () => {
    const x = makeApp({ API_DB_PORT: String(proxy.port), API_CONTACT_PHONE: '+27 11 000 0000', API_CONTACT_EMAIL: 'info@example.com' }, FAST);
    try {
      await proxy.setMode('refuse'); await sleep(100);
      const b = await json(await post(x.app, bookingBody()));
      expect(b['contact']).toEqual({ phone: '+27 11 000 0000', email: 'info@example.com' });
    } finally { await x.close(); }
  });
  it('after a failure the API fails fast for a moment (no pile-up) and then tries again', async () => {
    await proxy.setMode('refuse'); await sleep(100);
    await post(t.app, bookingBody());                                       // first failure starts the cooldown
    const before = t.db.stats.connectFailures;
    const started = Date.now();
    const r = await post(t.app, bookingBody());                              // inside the cooldown: no connection attempt
    expect(r.status).toBe(503); expect(Date.now() - started).toBeLessThan(100); expect(t.db.stats.connectFailures).toBe(before);
    await proxy.setMode('pass'); await sleep(300);
    expect((await post(t.app, bookingBody())).status).toBe(201);            // recovered
  });
});

describe('database hangs (accepts connections, never answers)', () => {
  it('booking ends within a couple of seconds as 503 with fallback "request", and saves nothing', async () => {
    expect((await post(t.app, bookingBody())).status).toBe(201);
    await proxy.setMode('blackhole'); await sleep(50);
    const key = randomUUID(); const started = Date.now();
    const r = await post(t.app, bookingBody(), {}, key);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.status).toBe(503);
    const b = await json(r);
    expect(['booking_unavailable', 'outcome_unknown']).toContain(b['error']); expect(b['fallback']).toBe('request');
    expect(await countKey(key)).toBe(0);
  });
  it('a hung database does not wedge the API: it answers again once the database is back', async () => {
    await proxy.setMode('blackhole'); await sleep(50);
    await post(t.app, bookingBody());
    await proxy.setMode('pass'); await sleep(400);
    expect((await post(t.app, bookingBody())).status).toBe(201);
  });
});

describe('the reply is lost after the database saved the booking (outcome unknown)', () => {
  it('says "outcome unknown" (never "saved", never "failed"), and a retry with the same key returns the one booking', async () => {
    expect((await post(t.app, bookingBody())).status).toBe(201);              // warm a pooled connection
    await proxy.setMode('drop-replies'); await sleep(50);
    const day = freshDay(); const key = randomUUID(); const body = bookingBody({ name: 'Lost Reply' }, day);
    const first = await post(t.app, body, {}, key);
    expect(first.status).toBe(503);
    const fb = await json(first);
    expect(fb['error']).toBe('outcome_unknown'); expect(fb['outcome']).toBe('unknown'); expect(fb['retry_with_same_key']).toBe(true); expect(fb['fallback']).toBe('request');
    expect(fb['reference']).toBeUndefined(); expect(fb['status']).toBeUndefined();
    expect(await countKey(key)).toBe(1);                                      // the database DID save it
    await proxy.setMode('pass'); await sleep(400);
    const retry = await post(t.app, body, {}, key);
    expect(retry.status).toBe(201);
    const [row] = await rows<{ reference: string }>('SELECT reference FROM reservations WHERE idempotency_key = $1', [key]);
    expect((await json(retry))['reference']).toBe(row?.reference);
    expect(await countKey(key)).toBe(1);                                      // still exactly one
  });
  it('a stale pooled connection (database restarted) is retried transparently with the same key: one booking, a 201', async () => {
    expect((await post(t.app, bookingBody())).status).toBe(201);              // pooled connection exists
    await proxy.setMode('refuse'); await sleep(20);                           // kills it...
    await proxy.setMode('pass');                                              // ...and the database is immediately back
    const key = randomUUID();
    const r = await post(t.app, bookingBody(), {}, key);
    expect(r.status).toBe(201);
    expect(await countKey(key)).toBe(1);
  });
});

describe('the database is not the development database (wrong environment label)', () => {
  it('the API refuses every request and says "request only"; it never reads or writes', async () => {
    const prod = process.env['TEST_PROD_DB'];
    expect(prod).toBeTruthy();
    const x = makeApp({ API_DB_NAME: prod }, FAST);
    try {
      const h = await get(x.app, '/api/health');
      expect(await h.json()).toEqual({ status: 'ok', booking: 'request_only' });
      const key = randomUUID();
      const r = await post(x.app, bookingBody(), {}, key);
      expect(r.status).toBe(503); expect((await json(r))['fallback']).toBe('request');
      expect(x.db.stats.queries).toBe(0);                                      // no statement ever reached that database
      expect(x.logs.join('\n')).toContain('db_environment_refused');
    } finally { await x.close(); }
  });
});

describe('failures leave no trace in logs of customer data', () => {
  it('error logs name the failure class only', async () => {
    const x = makeApp({ API_DB_PORT: String(proxy.port) }, FAST);
    try {
      await proxy.setMode('refuse'); await sleep(100);
      await post(x.app, bookingBody({ name: 'Secret Person', email: 'secret.person@example.com' }));
      const text = x.logs.join('\n');
      expect(text).toContain('request_failed');
      expect(text).not.toMatch(/Secret Person|secret\.person|ECONNREFUSED|127\.0\.0\.1|password/i);
    } finally { await x.close(); }
  });
});
