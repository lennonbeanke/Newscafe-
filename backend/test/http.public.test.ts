// Public API: health, availability, booking. Real local PostgreSQL (throw-away test database), real newscafe_public login.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bookingBody, dateAt, ensureVenue, freshDay, get, makeApp, post, rows, slotAt, withActiveTables, withSettings, withSpecialHours } from './helpers/fixtures.ts';
import type { TestApp } from './helpers/fixtures.ts';

let t: TestApp;
beforeAll(async () => { await ensureVenue(); t = makeApp(); });
afterAll(async () => { await t.close(); });
const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

describe('GET /api/health', () => {
  it('says only that the API is up and whether booking is usable (no internal details)', async () => {
    const x = makeApp();
    try {
      const r = await get(x.app, '/api/health');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ status: 'ok', booking: 'available' });
    } finally { await x.close(); }
  });
  it('answers repeated calls from a short cache: the database is not touched again', async () => {
    const x = makeApp();
    try {
      await get(x.app, '/api/health');
      const q = x.db.stats.queries;
      for (let i = 0; i < 20; i++) await get(x.app, '/api/health');
      expect(x.db.stats.queries).toBe(q);
    } finally { await x.close(); }
  });
  it('has no timer: nothing polls the database in the background', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const x = makeApp();
    try {
      await get(x.app, '/api/health'); await get(x.app, '/api/availability?date=' + dateAt(50) + '&party=2');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); await x.close(); }
  });
});

describe('GET /api/availability', () => {
  it('returns only start times for a free day: 10:00 to 21:30 every 30 minutes', async () => {
    const d = dateAt(freshDay());
    const r = await get(t.app, `/api/availability?date=${d}&party=2`);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(Object.keys(b).sort()).toEqual(['date', 'party', 'slots']);
    const slots = b['slots'] as string[];
    expect(slots).toHaveLength(24);
    expect(slots[0]).toBe(`${d}T08:00:00.000Z`);               // 10:00 at +02:00
    expect(slots).toContain(`${d}T17:00:00.000Z`);             // 19:00 local
    expect([...slots].sort()).toEqual(slots);
  });
  it('a closed day (special hours) has no slots', async () => {
    const d = dateAt(freshDay());
    await withSpecialHours(d, async () => {
      const b = await json(await get(t.app, `/api/availability?date=${d}&party=2`));
      expect(b['slots']).toEqual([]);
    });
  });
  it('offers fewer times once a table is taken (one-table restaurant)', async () => {
    const day = freshDay(); const d = dateAt(day);
    await withActiveTables(1, async () => {
      expect(((await json(await get(t.app, `/api/availability?date=${d}&party=2`)))['slots'] as string[])).toContain(`${d}T17:00:00.000Z`);
      expect((await post(t.app, bookingBody({}, day))).status).toBe(201);
      const after = (await json(await get(t.app, `/api/availability?date=${d}&party=2`)))['slots'] as string[];
      expect(after).not.toContain(`${d}T17:00:00.000Z`);
      expect(after).not.toContain(`${d}T17:30:00.000Z`);
      expect(after).toContain(`${d}T15:30:00.000Z`);           // 17:30 local still fits before 19:00
    });
  });
  it.each([
    ['missing date', 'party=2'], ['missing party', 'date=2026-12-04'], ['impossible date', 'date=2026-02-30&party=2'],
    ['wrong format', 'date=04-12-2026&party=2'], ['party zero', 'date=2026-12-04&party=0'], ['party 100', 'date=2026-12-04&party=100'],
    ['party text', 'date=2026-12-04&party=abc'], ['party decimal', 'date=2026-12-04&party=2.5'], ['unknown parameter', 'date=2026-12-04&party=2&x=1'],
    ['SQL injection', "date=2026-12-04'%3B%20DROP%20TABLE%20reservations%3B--&party=2"],
  ])('rejects %s with 422 and says where, not what', async (_n, q) => {
    const r = await get(t.app, '/api/availability?' + q);
    expect(r.status).toBe(422);
    const b = await json(r);
    expect(b['error']).toBe('validation_failed');
    expect(JSON.stringify(b)).not.toMatch(/DROP|reservations/);
    expect(Array.isArray(b['issues'])).toBe(true);
  });
  it('party above the online maximum -> 422 party_size_not_allowed', async () => {
    const r = await get(t.app, `/api/availability?date=${dateAt(60)}&party=11`);
    expect(r.status).toBe(422); expect((await json(r))['error']).toBe('party_size_not_allowed');
  });
  it('a date far outside the booking window -> 422 outside_booking_window', async () => {
    const r = await get(t.app, `/api/availability?date=${dateAt(900)}&party=2`);
    expect(r.status).toBe(422); expect((await json(r))['error']).toBe('outside_booking_window');
  });
  it('booking rules not configured -> 503 not_configured with fallback "request"', async () => {
    await withSettings({ slot_interval_minutes: null }, async () => {
      const r = await get(t.app, `/api/availability?date=${dateAt(61)}&party=2`);
      expect(r.status).toBe(503);
      const b = await json(r);
      expect(b['error']).toBe('not_configured'); expect(b['fallback']).toBe('request');
    });
  });
});

describe('POST /api/reservations', () => {
  it('saves a booking: 201 with only the reference, status and what the guest sent', async () => {
    const key = randomUUID(); const body = bookingBody({ notes: 'Window seat' });
    const r = await post(t.app, body, {}, key);
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(Object.keys(b).sort()).toEqual(['party_size', 'reference', 'starts_at', 'status']);
    expect(b['reference']).toMatch(/^[0-9A-F]{8}$/); expect(b['status']).toBe('pending'); expect(b['party_size']).toBe(2);
    expect(JSON.stringify(b)).not.toMatch(/guest@example|Test Guest|27 82/);
    const [row] = await rows<{ source: string; is_test: boolean; consent_at: Date | null; status: string; guest_name: string; guest_email: string; notes: string }>(
      'SELECT source, is_test, consent_at, status, guest_name, guest_email, notes FROM reservations WHERE idempotency_key = $1', [key]);
    expect(row).toMatchObject({ source: 'web', is_test: false, status: 'pending', guest_name: 'Test Guest', guest_email: 'guest@example.com', notes: 'Window seat' });
    expect(row?.consent_at).toBeInstanceOf(Date);
  });
  it('repeating the same request with the same key returns the same booking (never a second one)', async () => {
    const key = randomUUID(); const body = bookingBody();
    const a = await json(await post(t.app, body, {}, key)); const b = await json(await post(t.app, body, {}, key));
    expect(b).toEqual(a);
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(1);
  });
  it('the same key with a different request -> 409 idempotency_conflict, and nothing of the first guest is returned', async () => {
    const key = randomUUID(); const day = freshDay();
    expect((await post(t.app, bookingBody({}, day), {}, key)).status).toBe(201);
    const r = await post(t.app, bookingBody({ party_size: 3 }, day), {}, key);
    expect(r.status).toBe(409);
    const b = await json(r);
    expect(b['error']).toBe('idempotency_conflict'); expect(b['reference']).toBeUndefined();
  });
  it('email only, phone only', async () => {
    expect((await post(t.app, bookingBody({ phone: undefined }))).status).toBe(201);
    expect((await post(t.app, bookingBody({ email: undefined }))).status).toBe(201);
  });
  it('auto-confirm switched on by the owner -> status confirmed', async () => {
    await withSettings({ auto_confirm_enabled: true }, async () => {
      expect((await json(await post(t.app, bookingBody())))['status']).toBe('confirmed');
    });
  });
  it.each([
    ['not on a booking slot', { starts_at: '' }, 'not_on_slot', 422, '19:10'],
    ['outside opening hours', { starts_at: '' }, 'closed', 422, '03:00'],
    ['party above the online maximum', { party_size: 11 }, 'party_size_not_allowed', 422, '19:00'],
  ])('%s', async (_n, over, code, status, hhmm) => {
    const day = freshDay();
    const r = await post(t.app, bookingBody({ ...over, starts_at: slotAt(day, hhmm) }, day));
    expect(r.status).toBe(status); expect((await json(r))['error']).toBe(code);
  });
  it('a time in the past -> 422 outside_booking_window', async () => {
    const r = await post(t.app, bookingBody({ starts_at: slotAt(-3, '19:00') }));
    expect(r.status).toBe(422); expect((await json(r))['error']).toBe('outside_booking_window');
  });
  it('rules not configured -> 503 not_configured, fallback request, nothing saved', async () => {
    await withSettings({ slot_interval_minutes: null }, async () => {
      const key = randomUUID();
      const r = await post(t.app, bookingBody(), {}, key);
      expect(r.status).toBe(503);
      const b = await json(r);
      expect(b['error']).toBe('not_configured'); expect(b['fallback']).toBe('request');
      expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(0);
    });
  });
  it('no table free -> 409 no_availability with nearby alternatives', async () => {
    const day = freshDay();
    await withActiveTables(1, async () => {
      expect((await post(t.app, bookingBody({}, day))).status).toBe(201);
      const r = await post(t.app, bookingBody({ name: 'Second Guest', email: 'second@example.com' }, day));
      expect(r.status).toBe(409);
      const b = await json(r);
      expect(b['error']).toBe('no_availability');
      const alts = b['alternatives'] as string[];
      expect(alts.length).toBe(3);
      expect(alts).not.toContain(new Date(slotAt(day, '19:00')).toISOString());
      expect(JSON.stringify(b)).not.toMatch(/Second Guest|second@example/);
    });
  });
  it.each(['status', 'source', 'is_test', 'consent_at', 'id', 'reference', 'location_id', 'table_id', 'auto_confirm', 'actor'])(
    'a client cannot set "%s" (rejected, nothing saved)', async (field) => {
      const key = randomUUID();
      const r = await post(t.app, bookingBody({ [field]: field === 'is_test' ? true : 'confirmed' }), {}, key);
      expect(r.status).toBe(422);
      expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(0);
    });
  it.each([
    ['no Idempotency-Key', null], ['key too short', 'short'], ['key with spaces', 'key with spaces in it 123'], ['key with a semicolon', 'abcdefghijklmnop;1'],
  ])('%s -> 422', async (_n, key) => {
    const r = await post(t.app, bookingBody(), {}, key);
    expect(r.status).toBe(422);
  });
  it.each([
    ['consent false', { consent: false }], ['consent missing', { consent: undefined }], ['no contact method', { email: undefined, phone: undefined }],
    ['bad email', { email: 'nope' }], ['bad phone', { phone: 'abc' }], ['empty name', { name: '' }], ['name 101 characters', { name: 'x'.repeat(101) }],
    ['notes 501 characters', { notes: 'x'.repeat(501) }], ['starts_at without offset', { starts_at: '2026-12-04T19:00:00' }], ['party 0', { party_size: 0 }],
    ['control character in name', { name: 'a\u0000b' }],
  ])('validation: %s -> 422 validation_failed', async (_n, over) => {
    const key = randomUUID();
    const r = await post(t.app, bookingBody(over), {}, key);
    expect(r.status).toBe(422); expect((await json(r))['error']).toBe('validation_failed');
    expect(await rows('SELECT 1 FROM reservations WHERE idempotency_key = $1', [key])).toHaveLength(0);
  });
});

describe('protocol hygiene', () => {
  it('wrong or missing content type -> 415', async () => {
    expect((await post(t.app, 'x=1', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(t.app, '{}', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    const r = await t.app.request('/api/reservations', { method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: '{}' });
    expect(r.status).toBe(415);
  });
  it('malformed JSON -> 400', async () => {
    const r = await post(t.app, '{"party_size": ');
    expect(r.status).toBe(400); expect((await json(r))['error']).toBe('malformed_json');
  });
  it('a JSON array or string body is not accepted', async () => {
    expect((await post(t.app, '[1,2,3]')).status).toBe(422);
    expect((await post(t.app, '"hello"')).status).toBe(422);
  });
  it('body over 16 KB -> 413', async () => {
    const r = await post(t.app, JSON.stringify({ name: 'x'.repeat(20_000) }));
    expect(r.status).toBe(413); expect((await json(r))['error']).toBe('payload_too_large');
  });
  it('unknown path -> 404 JSON, wrong method -> 405 with Allow', async () => {
    const a = await get(t.app, '/api/nothing'); expect(a.status).toBe(404); expect((await json(a))['error']).toBe('not_found');
    const b = await get(t.app, '/api/reservations'); expect(b.status).toBe(405); expect(b.headers.get('allow')).toContain('POST');
    const c = await t.app.request('/api/availability', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); expect(c.status).toBe(405);
    expect((await get(t.app, '/api/../etc/passwd')).status).toBe(404);
  });
  it('CORS: only the configured local origin is ever echoed back', async () => {
    const ok = await t.app.request('/api/reservations', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' } });
    expect(ok.status).toBeLessThan(300); expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const evil = await t.app.request('/api/reservations', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
    expect(evil.headers.get('access-control-allow-credentials')).toBeNull();
  });
  it.each([['200 health', '/api/health'], ['404', '/api/nothing'], ['422', '/api/availability?date=x&party=2']])('security headers are present on %s', async (_n, path) => {
    const r = await get(t.app, path);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull(); expect(r.headers.get('server')).toBeNull();
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('rate limits: reservations 10 per 10 minutes per client, availability 60 per minute; other clients unaffected', async () => {
    const me = { 'x-test-client': 'rate-test-a' };
    for (let i = 0; i < 10; i++) expect((await post(t.app, {}, me)).status).toBe(422);
    const blocked = await post(t.app, {}, me);
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0); expect((await json(blocked))['error']).toBe('rate_limited');
    expect((await post(t.app, {}, { 'x-test-client': 'rate-test-b' })).status).toBe(422);
    const q = `/api/availability?date=${dateAt(70)}&party=2`;
    for (let i = 0; i < 60; i++) expect((await get(t.app, q, { 'x-test-client': 'rate-test-c' })).status).toBe(200);
    expect((await get(t.app, q, { 'x-test-client': 'rate-test-c' })).status).toBe(429);
  });
});

describe('availability cache', () => {
  it('serves a repeat from a short cache, and a booking makes it fresh again', async () => {
    const x = makeApp({}, { availabilityTtlMs: 60_000 });
    try {
      const day = freshDay(); const q = `/api/availability?date=${dateAt(day)}&party=2`;
      await get(x.app, q); const n = x.db.stats.queries;
      await get(x.app, q); expect(x.db.stats.queries).toBe(n);
      expect((await post(x.app, bookingBody({}, day))).status).toBe(201);
      const before = x.db.stats.queries; await get(x.app, q); expect(x.db.stats.queries).toBe(before + 1);
    } finally { await x.close(); }
  });
});
