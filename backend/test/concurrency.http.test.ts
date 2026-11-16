// Simultaneous bookings through the REAL HTTP server (a real TCP port on 127.0.0.1, real API-role database logins).
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingBody, ensureVenue, freshDay, makeApp, rows, slotAt, withActiveTables } from './helpers/fixtures.ts';
import type { TestApp } from './helpers/fixtures.ts';

let t: TestApp; let server: ReturnType<typeof serve>; let base = '';
beforeAll(async () => {
  await ensureVenue();
  t = makeApp({}, { dbConnectTimeoutMs: 15_000 });   // generous: these tests are about correctness under load, not timeouts
  await new Promise<void>((resolve) => { server = serve({ fetch: t.app.fetch, port: 0, hostname: '127.0.0.1' }, (i: AddressInfo) => { base = `http://127.0.0.1:${i.port}`; resolve(); }); });
});
afterAll(async () => { await new Promise<void>((r) => { server.close(() => r()); }); await t.close(); });

const send = async (body: unknown, key: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(base + '/api/reservations', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-test-client': randomUUID() },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const guest = (i: number, day: number, over: Record<string, unknown> = {}) =>
  bookingBody({ name: `Guest ${i}`, email: `guest${i}@example.com`, ...over }, day);
const tally = (rs: { status: number }[]) => rs.reduce<Record<number, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});

describe('simultaneous bookings over HTTP', () => {
  it('60 guests, ONE free table: exactly one is saved, 59 are told there is no table', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => send(guest(i, day), randomUUID())));
      expect(tally(rs)).toEqual({ 201: 1, 409: 59 });
      expect(rs.filter((r) => r.status === 409).every((r) => r.body['error'] === 'no_availability')).toBe(true);
      const saved = await rows('SELECT 1 FROM reservations WHERE starts_at = $1::timestamptz', [slotAt(day, '19:00')]);
      expect(saved).toHaveLength(1);
    });
  });

  it('120 guests, 44 tables: exactly 44 are saved, 76 refused, no table is ever double booked', async () => {
    const day = freshDay();
    const rs = await Promise.all(Array.from({ length: 120 }, (_, i) => send(guest(i, day), randomUUID())));
    expect(tally(rs)).toEqual({ 201: 44, 409: 76 });
    const [dup] = await rows<{ n: string }>(`SELECT count(*)::text AS n FROM (SELECT table_id FROM table_allocations a JOIN reservations r ON r.id = a.reservation_id
        WHERE a.active AND r.starts_at = $1::timestamptz GROUP BY table_id HAVING count(*) > 1) x`, [slotAt(day, '19:00')]);
    expect(dup?.n).toBe('0');
    const [orph] = await rows<{ n: string }>(`SELECT count(*)::text AS n FROM reservations r WHERE r.starts_at = $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM table_allocations a WHERE a.reservation_id = r.id)`, [slotAt(day, '19:00')]);
    expect(orph?.n).toBe('0');
  });

  it('the SAME request sent 20 times at once (same Idempotency-Key): one booking, every caller gets the same reference', async () => {
    const day = freshDay(); const key = randomUUID(); const body = guest(1, day);
    const rs = await Promise.all(Array.from({ length: 20 }, () => send(body, key)));
    expect(tally(rs)).toEqual({ 201: 20 });
    expect(new Set(rs.map((r) => r.body['reference'])).size).toBe(1);
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(1);
  });

  it('one key, two DIFFERENT requests at once: one request shape wins, the other is refused and never sees the winner\'s booking', async () => {
    const day = freshDay(); const key = randomUUID();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => send(guest(1, day, { party_size: 1 + (i % 2) }), key)));
    const created = rs.filter((r) => r.status === 201); const refused = rs.filter((r) => r.status === 409);
    expect(created.length + refused.length).toBe(20);
    expect(created.length).toBeGreaterThan(0); expect(refused.length).toBeGreaterThan(0);
    expect(new Set(created.map((r) => r.body['reference'])).size).toBe(1);
    expect(refused.every((r) => r.body['error'] === 'idempotency_conflict' && r.body['reference'] === undefined)).toBe(true);
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(1);
  });

  it('a double-click (two identical requests a few milliseconds apart) saves one booking', async () => {
    const day = freshDay(); const key = randomUUID(); const body = guest(2, day);
    const a = send(body, key); await new Promise((r) => setTimeout(r, 5)); const b = send(body, key);
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([201, 201]); expect(ra.body['reference']).toBe(rb.body['reference']);
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(1);
  });

  it('availability read while bookings land never errors', async () => {
    const day = freshDay();
    const readers = Array.from({ length: 40 }, () => fetch(`${base}/api/availability?date=${slotAt(day, '19:00').slice(0, 10)}&party=2`, { headers: { 'x-test-client': randomUUID() } }).then((r) => r.status));
    const writers = Array.from({ length: 40 }, (_, i) => send(guest(i, day), randomUUID()).then((r) => r.status));
    const all = await Promise.all([...readers, ...writers]);
    expect(all.every((s) => s === 200 || s === 201)).toBe(true);
  });
});
