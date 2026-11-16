// Security behaviour: hostile input, error hygiene, log hygiene, no data leaking between guests.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookingBody, dateAt, ensureVenue, freshDay, get, makeApp, post, rows, withSettings } from './helpers/fixtures.ts';
import type { TestApp } from './helpers/fixtures.ts';

let t: TestApp;
beforeAll(async () => { await ensureVenue(); t = makeApp(); });
afterAll(async () => { await t.close(); });
const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

describe('hostile input is treated as plain data', () => {
  const hostile: [string, string][] = [
    ['SQL injection', "Robert'); DROP TABLE reservations;--"], ['SQL injection (union)', "x' UNION SELECT password_hash FROM admin_users--"],
    ['HTML/script', '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>'], ['template injection', '{{7*7}} ${7*7} #{7*7} <%= 7*7 %>'],
    ['shell metacharacters', '$(touch /tmp/pwned); `id`; | cat /etc/passwd'], ['path traversal', '../../../../etc/passwd'], ['JSON-ish', '{"a":{"$ne":null}}'],
    ['unicode (emoji, accents, CJK)', 'Zoë 🍸 名前 Ünï'], ['right-to-left override', 'abc‮def'], ['log forging', 'x\\n{"level":"info","event":"admin_login"}'],
    ['long but legal', 'n'.repeat(100)],
  ];
  it.each(hostile)('%s in the name and notes is stored exactly as written; nothing runs', async (_n, text) => {
    const key = randomUUID();
    const name = text.slice(0, 100);
    const r = await post(t.app, bookingBody({ name, notes: text.slice(0, 500) }), {}, key);
    expect(r.status).toBe(201);
    const [row] = await rows<{ guest_name: string; notes: string }>('SELECT guest_name, notes FROM reservations WHERE idempotency_key = $1', [key]);
    expect(row?.guest_name).toBe(name.trim()); expect(row?.notes).toBe(text.slice(0, 500).trim());
    expect((await rows('SELECT to_regclass(\'public.reservations\') AS t'))[0]).toMatchObject({ t: 'reservations' });
  });
  it('control characters (NUL, bell) in the name are refused', async () => {
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u001bb']) expect((await post(t.app, bookingBody({ name: bad }))).status).toBe(422);
  });
  it('prototype-pollution and odd JSON are refused, not crashed on', async () => {
    for (const raw of ['{"__proto__":{"admin":true}}', '{"constructor":{"prototype":{"x":1}}}', '{"party_size":1e999}', '{"party_size":-0}', '[]', 'null', '{"a":' + '{"a":'.repeat(500) + '1' + '}'.repeat(501)]) {
      const r = await post(t.app, raw);
      expect([400, 422], raw.slice(0, 40)).toContain(r.status);
    }
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
  it('a 15 KB name inside the size limit is refused by validation (not crashed on)', async () => {
    expect((await post(t.app, bookingBody({ name: 'x'.repeat(15_000) }))).status).toBe(422);
  });
  it('injection through the query string is refused', async () => {
    for (const q of ["date=2026-12-04' OR '1'='1&party=2", 'date=2026-12-04&party=2;DROP TABLE reservations', 'date[]=1&party=2']) {
      expect((await get(t.app, '/api/availability?' + q)).status).toBe(422);
    }
  });
});

describe('error answers never expose internals', () => {
  it('no SQL, table, role, host, port, path or stack text in any error body', async () => {
    const day = freshDay();
    const bodies: string[] = [];
    const grab = async (r: Response) => { bodies.push(await r.text()); };
    await grab(await post(t.app, bookingBody({}, day), {}, null));
    await grab(await post(t.app, '{"x":'));
    await grab(await post(t.app, bookingBody({ party_size: 11 })));
    await grab(await post(t.app, bookingBody({ consent: false })));
    await grab(await get(t.app, '/api/availability?date=bad&party=2'));
    await grab(await get(t.app, '/api/nope'));
    await grab(await get(t.app, '/api/reservations'));
    await withSettings({ slot_interval_minutes: null }, async () => { await grab(await post(t.app, bookingBody())); await grab(await get(t.app, `/api/availability?date=${dateAt(90)}&party=2`)); });
    const key = randomUUID(); await post(t.app, bookingBody({}, day), {}, key); await grab(await post(t.app, bookingBody({ party_size: 3 }, day), {}, key));
    const all = bodies.join('\n');
    expect(bodies.length).toBeGreaterThan(8);
    expect(all).not.toMatch(/SELECT|INSERT|public_book|public_available|newscafe_|pg_|password|ECONN|127\.0\.0\.1|54329|node_modules|\.ts:|\bat \w+ \(|stack|postgres/i);
  });
  it('every error carries a request id the owner can quote, and nothing else identifying', async () => {
    const r = await get(t.app, '/api/nope');
    expect((await json(r))['request_id']).toBe(r.headers.get('x-request-id'));
  });
});

describe('logs hold no personal data and no secrets', () => {
  it('names, e-mails, phones, notes, idempotency keys, passwords and keys never appear in any log line', async () => {
    const x = makeApp(); const day = freshDay();
    const marker = { name: 'Zorro Marker-7731', email: 'zorro.marker7731@example.com', phone: '+27 83 777 7731', notes: 'MARKER-NOTES-7731 allergy' };
    const key = 'marker-key-' + randomUUID();
    try {
      await post(x.app, bookingBody({ ...marker }, day), {}, key);                       // success
      await post(x.app, bookingBody({ ...marker }, day), {}, key);                       // replay
      await post(x.app, bookingBody({ ...marker, party_size: 4 }, day), {}, key);        // conflict (409)
      await post(x.app, bookingBody({ ...marker, consent: false }), {}, key + '-b');     // validation failure
      await post(x.app, bookingBody({ ...marker, starts_at: '2020-01-01T10:00:00+02:00' }), {}, key + '-c');   // rule failure
      await withSettings({ slot_interval_minutes: null }, async () => { await post(x.app, bookingBody({ ...marker }), {}, key + '-d'); });   // 503
      await get(x.app, `/api/availability?date=${dateAt(day)}&party=2`);
      await get(x.app, '/api/health');
      const text = x.logs.join('\n');
      expect(x.logs.length).toBeGreaterThan(8);
      for (const secret of [...Object.values(marker), key, x.config.dbPassword, process.env['API_DB_ADMIN_PASSWORD'] ?? 'unset-admin-password', process.env['API_HMAC_KEY'] ?? 'unset-hmac', process.env['API_TOTP_ENC_KEY'] ?? 'unset-totp']) {
        expect(text, `log must not contain "${secret.slice(0, 12)}…"`).not.toContain(secret);
      }
      expect(text).not.toMatch(/zorro|MARKER|7731|authorization|cookie|password/i);
      const allowed = new Set(['t', 'level', 'event', 'request_id', 'method', 'route', 'status', 'duration_ms', 'code', 'error_class', 'outcome', 'reason', 'booking', 'cache', 'count', 'port', 'env', 'pool', 'problems', 'signal']);
      for (const line of x.logs) for (const k of Object.keys(JSON.parse(line) as object)) expect(allowed.has(k), `unexpected log field ${k}`).toBe(true);
      expect(text).toContain('/api/reservations');   // routes are logged as patterns...
      expect(text).not.toContain('date=');           // ...never with the query string
    } finally { await x.close(); }
  });
});

describe('guests are isolated from each other', () => {
  it('each guest gets back only their own details; there is no way to look up another booking', async () => {
    const day = freshDay();
    const a = await json(await post(t.app, bookingBody({ name: 'Alice Alpha', email: 'alice@example.com', party_size: 2 }, day)));
    const b = await json(await post(t.app, bookingBody({ name: 'Bob Beta', email: 'bob@example.com', party_size: 3 }, day)));
    expect(a['reference']).not.toBe(b['reference']);
    expect(JSON.stringify([a, b])).not.toMatch(/Alice|Bob|alice@|bob@/);
    for (const path of [`/api/reservations/${String(a['reference'])}`, '/api/admin/reservations', '/api/reservations?reference=' + String(a['reference'])]) {
      expect((await get(t.app, path)).status).toBeGreaterThanOrEqual(404);
    }
  });
});
