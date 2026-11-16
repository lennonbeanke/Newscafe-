// Test fixtures. Superuser access (from TEST_SU_* set by backend/scripts/api-test.sh) is used ONLY here, to prepare fake data in the
// throw-away test database. The API under test connects with its own least-privilege roles.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';
import { loadPublicConfig } from '../../src/config.ts';
import type { PublicConfig, Tuning } from '../../src/config.ts';
import { Db } from '../../src/db.ts';
import { createLogger } from '../../src/logger.ts';
import { buildPublicApp } from '../../src/public-app.ts';
import { Services } from '../../src/services.ts';
import type { Context } from 'hono';

export const VENUE = '00000000-0000-4000-8000-0000000000a1';

const PUBLIC_KEYS = ['APP_ENV', 'API_PORT', 'API_DB_HOST', 'API_DB_PORT', 'API_DB_NAME', 'API_DB_PUBLIC_USER', 'API_DB_PUBLIC_PASSWORD', 'API_ALLOWED_ORIGIN', 'API_OUTBOX_DIR'];
const ADMIN_KEYS = ['APP_ENV', 'API_ADMIN_PORT', 'API_DB_HOST', 'API_DB_PORT', 'API_DB_NAME', 'API_DB_ADMIN_USER', 'API_DB_ADMIN_PASSWORD', 'API_HMAC_KEY', 'API_ADMIN_ALLOWED_ORIGIN'];

function pick(keys: string[], overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const k of keys) env[k] = process.env[k];
  const merged = { ...env, ...overrides };
  if (!merged['API_DB_NAME']?.startsWith('newscafe_test')) throw new Error('tests must run against a newscafe_test* database (use backend/scripts/api-test.sh)');
  return merged;
}
/** The environment the PUBLIC process would get: only public settings. */
export const testPublicEnv = (overrides: Record<string, string | undefined> = {}) => pick(PUBLIC_KEYS, overrides);
/** The environment the ADMIN process would get: only admin settings. */
export const testAdminEnv = (overrides: Record<string, string | undefined> = {}) => pick(ADMIN_KEYS, overrides);
export const testEnv = testPublicEnv;

export function testConfig(overrides: Record<string, string | undefined> = {}, tuning: Partial<Tuning> = {}): PublicConfig {
  return loadPublicConfig(testPublicEnv(overrides), { tuning: { availabilityTtlMs: 0, dbCooldownMs: 50, ...tuning } });
}

export interface TestApp {
  app: ReturnType<typeof buildPublicApp>; db: Db; services: Services; config: PublicConfig; logs: string[]; close(): Promise<void>;
}
export function makeApp(overrides: Record<string, string | undefined> = {}, tuning: Partial<Tuning> = {}): TestApp {
  const config = testConfig(overrides, tuning);
  const logs: string[] = [];
  const logger = createLogger((l) => logs.push(l));
  const db = new Db({ host: config.dbHost, port: config.dbPort, database: config.dbName, user: config.dbUser, password: config.dbPassword,
    tuning: config.tuning, envProbe: 'SELECT public_environment() AS env' }, logger);
  const services = new Services(config, db);
  // tests choose the "client" with a header so rate limits can be exercised without real network addresses
  const clientId = (c: Context): string => c.req.header('x-test-client') ?? 'default-client';
  const app = buildPublicApp({ config, db, services, logger, clientId });
  return { app, db, services, config, logs, close: () => db.close() };
}

export async function su(): Promise<pg.Client> {
  const c = new pg.Client({
    host: process.env['API_DB_HOST'], port: Number(process.env['API_DB_PORT']), database: process.env['API_DB_NAME'],
    user: process.env['TEST_SU_USER'], password: process.env['TEST_SU_PASSWORD'],
  });
  await c.connect();
  return c;
}

/** Creates the fake venue once: open every day 10:00-22:00, 44 tables, slot 30 min, 90 min dining. Safe to call repeatedly. */
export async function ensureVenue(): Promise<void> {
  const c = await su();
  try {
    await c.query(`INSERT INTO locations (id, name, street, suburb, city, region, postal_code)
                   VALUES ($1, 'API TEST VENUE', '1 Test St', 'T', 'T', 'T', '0000') ON CONFLICT DO NOTHING`, [VENUE]);
    await c.query(`INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at)
                   SELECT $1, d, time '10:00', time '22:00' FROM generate_series(1, 7) d
                    WHERE NOT EXISTS (SELECT 1 FROM opening_hours WHERE location_id = $1)`, [VENUE]);
    await c.query(`INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
                     max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes, auto_confirm_enabled)
                   VALUES ($1, 30, 0, 1, 10, 0, 3650, 0, false) ON CONFLICT DO NOTHING`, [VENUE]);
    await c.query(`INSERT INTO duration_rules (location_id, name, duration_minutes)
                   SELECT $1, 'default', 90 WHERE NOT EXISTS (SELECT 1 FROM duration_rules WHERE location_id = $1)`, [VENUE]);
    await c.query(`INSERT INTO dining_tables (location_id, label, min_covers, max_covers, sort)
                   SELECT $1, 'T' || lpad(n::text, 2, '0'), CASE WHEN n <= 40 THEN 1 ELSE 2 END, CASE WHEN n <= 40 THEN 2 ELSE 6 END, n
                     FROM generate_series(1, 44) n
                    WHERE NOT EXISTS (SELECT 1 FROM dining_tables WHERE location_id = $1)`, [VENUE]);
  } finally { await c.end(); }
}

export async function withSettings<T>(patch: Record<string, number | boolean | null>, fn: () => Promise<T>): Promise<T> {
  const c = await su();
  const cols = Object.keys(patch);
  try {
    const before = (await c.query(`SELECT ${cols.join(', ')} FROM reservation_settings WHERE location_id = $1`, [VENUE])).rows[0] as Record<string, unknown>;
    await c.query(`UPDATE reservation_settings SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE location_id = $1`, [VENUE, ...cols.map((k) => patch[k])]);
    try { return await fn(); }
    finally { await c.query(`UPDATE reservation_settings SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE location_id = $1`, [VENUE, ...cols.map((k) => before[k])]); }
  } finally { await c.end(); }
}

/** Only the first n tables stay active (n = 1 gives a one-table restaurant). */
export async function withActiveTables<T>(n: number, fn: () => Promise<T>): Promise<T> {
  const c = await su();
  try {
    await c.query('UPDATE dining_tables SET is_active = (sort <= $2) WHERE location_id = $1', [VENUE, n]);
    try { return await fn(); }
    finally { await c.query('UPDATE dining_tables SET is_active = true WHERE location_id = $1', [VENUE]); }
  } finally { await c.end(); }
}

export async function withSpecialHours<T>(date: string, fn: () => Promise<T>): Promise<T> {
  const c = await su();
  try {
    await c.query(`INSERT INTO special_hours (location_id, on_date, is_closed, label) VALUES ($1, $2, true, 'test closure')`, [VENUE, date]);
    try { return await fn(); } finally { await c.query('DELETE FROM special_hours WHERE location_id = $1 AND on_date = $2', [VENUE, date]); }
  } finally { await c.end(); }
}

export async function rows<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await su();
  try { return (await c.query<T>(sql, params)).rows; } finally { await c.end(); }
}

// ---- request helpers ------------------------------------------------------------------------------------------------
/** ISO timestamp with the venue's +02:00 offset, `dayOffset` days from today (UTC date), at local HH:MM. */
export function slotAt(dayOffset: number, hhmm: string): string {
  const d = new Date(Date.now() + dayOffset * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00+02:00`;
}
export function dateAt(dayOffset: number): string { return new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10); }

// Every test takes its own future date so bookings never interfere (history is append-only: nothing is ever deleted), and every
// test FILE gets its own block of days because all files share one database. (The API only answers for dates up to ~400 days ahead.)
const DAY_BLOCKS: Record<string, number> = { 'concurrency.http': 40, 'failure': 60, 'security': 100, 'http.public': 170, 'admin.reservations': 500, 'admin.authz': 900, 'admin.failure': 1000, 'isolation': 1100 };
function firstDay(): number {
  const file = expect.getState().testPath ?? '';
  for (const [name, base] of Object.entries(DAY_BLOCKS)) if (file.includes(`/${name}.test.ts`)) return base;
  return 300;
}
let day = -1;
export function freshDay(): number {
  if (day < 0) day = firstDay();
  if (day > (firstDay() < 400 ? 395 : 1500)) throw new Error('test day budget exhausted: give this test file a bigger block in DAY_BLOCKS');
  return day++;
}

export function bookingBody(over: Record<string, unknown> = {}, dayOffset = freshDay()): Record<string, unknown> {
  return { party_size: 2, starts_at: slotAt(dayOffset, '19:00'), name: 'Test Guest', email: 'guest@example.com', phone: '+27 82 000 0000', consent: true, ...over };
}

export function post(app: TestApp['app'], body: unknown, headers: Record<string, string> = {}, key: string | null = randomUUID()): Promise<Response> {
  const h: Record<string, string> = { 'content-type': 'application/json', 'x-test-client': randomUUID(), ...headers };
  if (key !== null) h['idempotency-key'] = key;
  return Promise.resolve(app.request('/api/reservations', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }));
}
export const get = (app: TestApp['app'], path: string, headers: Record<string, string> = {}): Promise<Response> =>
  Promise.resolve(app.request(path, { headers: { 'x-test-client': randomUUID(), ...headers } }));

/** A pending web booking made straight in the database (as the public API would), for the owner to manage. */
export async function makePending(dayOffset: number, o: { party?: number; name?: string; email?: string; phone?: string; at?: string; test?: boolean } = {}): Promise<string> {
  const c = await su();
  try {
    const r = await c.query<{ id: string }>(`SELECT book_reservation($1, $2, $3::timestamptz, $4, $5, $6, NULL, 'web', $7, now(), NULL) AS id`,
      [VENUE, o.party ?? 2, slotAt(dayOffset, o.at ?? '19:00'), o.name ?? 'Pending Guest', o.email ?? 'pending@example.com', o.phone ?? '+27 82 111 1111', o.test ?? false]);
    return r.rows[0]!.id;
  } finally { await c.end(); }
}
