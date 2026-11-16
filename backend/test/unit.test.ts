// Unit tests: startup guards, logging redaction, rate limiter, error mapping, input schemas. No database needed.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadAdminConfig, loadPublicConfig } from '../src/config.ts';
import { DbEnvironmentRefused, DbOutcomeUnknown, DbUnavailable, mapDbFailure, sqlstateOf } from '../src/errors.ts';
import { createLogger } from '../src/logger.ts';
import { RateLimiter } from '../src/rate-limit.ts';
import { AvailabilityQuery, ReservationBody } from '../src/schemas.ts';

const API_DIR = path.resolve('/work/backend');   // platform-aware absolute folder used by the outbox guard
const PW_PUBLIC = 'p'.repeat(48);
const PW_ADMIN = 'q'.repeat(48);
const common: Record<string, string> = { APP_ENV: 'development', API_DB_HOST: '127.0.0.1', API_DB_PORT: '54329', API_DB_NAME: 'newscafe_dev' };
const publicBase: Record<string, string> = {
  ...common, API_PORT: '8787', API_DB_PUBLIC_USER: 'newscafe_public', API_DB_PUBLIC_PASSWORD: PW_PUBLIC,
  API_ALLOWED_ORIGIN: 'http://localhost:3000', API_OUTBOX_DIR: 'backend/.outbox',
};
const adminBase: Record<string, string> = {
  ...common, API_ADMIN_PORT: '8788', API_DB_ADMIN_USER: 'newscafe_admin', API_DB_ADMIN_PASSWORD: PW_ADMIN,
  API_HMAC_KEY: '1'.repeat(64), API_ADMIN_ALLOWED_ORIGIN: 'http://localhost:3000',
};
type Over = Record<string, string | undefined>;
const attempt = (which: 'public' | 'admin', over: Over): string[] => {
  const env = { ...(which === 'public' ? publicBase : adminBase), ...over };
  try { if (which === 'public') loadPublicConfig(env, { apiDir: API_DIR }); else loadAdminConfig(env); } catch (e) {
    if (e instanceof ConfigError) return [...e.problems];
    throw e;
  }
  throw new Error(`NOT REFUSED (${which}): ` + JSON.stringify(over));
};
const refusedPublic = (over: Over) => attempt('public', over);
const refusedAdmin = (over: Over) => attempt('admin', over);

describe.each(['public', 'admin'] as const)('startup guards, %s process (refuses to start unless clearly the local development setup)', (which) => {
  const refused = (over: Over) => attempt(which, over);
  const portKey = which === 'public' ? 'API_PORT' : 'API_ADMIN_PORT';
  it('accepts the normal development configuration', () => {
    const c = which === 'public' ? loadPublicConfig(publicBase, { apiDir: API_DIR }) : loadAdminConfig(adminBase);
    expect(c.host).toBe('127.0.0.1'); expect(c.env).toBe('development'); expect(Object.isFrozen(c)).toBe(true);
    if (c.kind === 'public') expect(c.outboxDir).toBe(path.join(API_DIR, '.outbox'));
  });
  it('refuses any environment other than development', () => {
    expect(refused({ APP_ENV: 'production' }).join()).toMatch(/APP_ENV/);
    expect(refused({ APP_ENV: 'staging' }).join()).toMatch(/APP_ENV/);
    expect(refused({ APP_ENV: undefined }).join()).toMatch(/APP_ENV/);
    expect(refused({ NODE_ENV: 'production' }).join()).toMatch(/NODE_ENV/);
  });
  it.each(['DATABASE_URL', 'PGHOST', 'PGHOSTADDR', 'PGDATABASE', 'PGSERVICE', 'PGUSER', 'PGPASSWORD', 'PGPORT', 'PGSSLMODE'])(
    'refuses when %s is set in the environment (it could redirect the connection)', (name) => {
      expect(refused({ [name]: 'x' }).join()).toContain(name);
    });
  it.each(['db.example.com', '10.0.0.5', '0.0.0.0', '192.168.1.20', '::1', ''])('refuses database host "%s"', (host) => {
    expect(refused({ API_DB_HOST: host }).join()).toMatch(/API_DB_HOST/);
  });
  it.each(['newscafe_prod', 'newscafe_production', 'postgres', 'template1', 'newscafe', 'newscafe_dev; DROP', 'NEWSCAFE_DEV', 'newscafe_devx'])(
    'refuses database name "%s"', (name) => { expect(refused({ API_DB_NAME: name }).join()).toMatch(/API_DB_NAME/); });
  it.each(['newscafe_dev', 'newscafe_test', 'newscafe_test_apihttp'])('accepts database name "%s"', (name) => {
    const env = { ...(which === 'public' ? publicBase : adminBase), API_DB_NAME: name };
    expect((which === 'public' ? loadPublicConfig(env, { apiDir: API_DIR }) : loadAdminConfig(env)).dbName).toBe(name);
  });
  it('refuses ports outside 1024-65535', () => {
    expect(refused({ [portKey]: '80' }).join()).toMatch(new RegExp(portKey));
    expect(refused({ API_DB_PORT: 'abc' }).join()).toMatch(/API_DB_PORT/);
  });
  it('refuses a remote or non-http web origin', () => {
    const k = which === 'public' ? 'API_ALLOWED_ORIGIN' : 'API_ADMIN_ALLOWED_ORIGIN';
    for (const o of ['https://example.com', 'http://evil.example', 'http://localhost:3000/path', '*', 'localhost:3000', 'http://localhost.evil.com']) {
      expect(refused({ [k]: o }).join(), o).toMatch(new RegExp(k));
    }
  });
  it('never puts a secret value into a refusal message', () => {
    const msgs = refused({ APP_ENV: 'production', API_DB_HOST: 'evil.example', DATABASE_URL: 'postgres://u:topsecret@h/db' }).join('|');
    for (const secret of [PW_PUBLIC, PW_ADMIN, 'topsecret', '1'.repeat(64), '2'.repeat(64), 'evil.example']) expect(msgs).not.toContain(secret);
  });
  it('reports every problem at once', () => {
    expect(refused({ APP_ENV: 'production', [portKey]: '1', API_DB_HOST: 'x' }).length).toBeGreaterThanOrEqual(3);
  });
});

describe('startup guards, public process only', () => {
  it('refuses superuser / owner accounts and weak passwords', () => {
    for (const u of ['postgres', 'newscafe_dev_user', 'newscafe_admin']) expect(refusedPublic({ API_DB_PUBLIC_USER: u }).join()).toMatch(/API_DB_PUBLIC_USER/);
    expect(refusedPublic({ API_DB_PUBLIC_PASSWORD: 'short' }).join()).toMatch(/PUBLIC_PASSWORD/);
  });
  it.each(['../../etc', '/tmp/outbox', 'backend/../..', '.', 'backend'])('refuses outbox folder "%s" (must stay inside backend/)', (o) => {
    expect(refusedPublic({ API_OUTBOX_DIR: o }).join()).toMatch(/API_OUTBOX_DIR/);
  });
  it('refuses junk contact details', () => {
    expect(refusedPublic({ API_CONTACT_EMAIL: 'nope' }).join()).toMatch(/API_CONTACT_EMAIL/);
    expect(refusedPublic({ API_CONTACT_PHONE: 'call me' }).join()).toMatch(/API_CONTACT_PHONE/);
  });
});

describe('startup guards, admin process only', () => {
  it('refuses superuser / owner accounts, weak or missing secrets', () => {
    for (const u of ['postgres', 'newscafe_dev_user', 'newscafe_public']) expect(refusedAdmin({ API_DB_ADMIN_USER: u }).join()).toMatch(/API_DB_ADMIN_USER/);
    expect(refusedAdmin({ API_DB_ADMIN_PASSWORD: 'short' }).join()).toMatch(/ADMIN_PASSWORD/);
    expect(refusedAdmin({ API_HMAC_KEY: 'zz' }).join()).toMatch(/API_HMAC_KEY/);
    // the former authenticator key is not part of the settings any more: absent is fine, and an old value left in the file is ignored
    expect(() => loadAdminConfig({ ...adminBase })).not.toThrow();
    expect(() => loadAdminConfig({ ...adminBase, API_TOTP_ENC_KEY: 'not even hex' })).not.toThrow();
    expect(loadAdminConfig({ ...adminBase, API_TOTP_ENC_KEY: '3'.repeat(64) })).not.toHaveProperty('totpKey');
    expect(refusedAdmin({ API_HMAC_KEY: undefined }).join()).toMatch(/API_HMAC_KEY is missing/);
  });
});

describe('CREDENTIAL ISOLATION: each process refuses to start if it can see the other one\'s secrets', () => {
  it.each(['API_DB_ADMIN_PASSWORD', 'API_DB_ADMIN_USER', 'API_HMAC_KEY', 'API_TOTP_ENC_KEY', 'API_ADMIN_PORT', 'API_ADMIN_ALLOWED_ORIGIN'])(
    'the PUBLIC process refuses %s', (name) => { expect(refusedPublic({ [name]: 'present' }).join()).toContain(name); });
  it.each(['API_DB_PUBLIC_PASSWORD', 'API_DB_PUBLIC_USER', 'API_PORT', 'API_OUTBOX_DIR', 'API_ALLOWED_ORIGIN'])(
    'the ADMIN process refuses %s', (name) => { expect(refusedAdmin({ [name]: 'present' }).join()).toContain(name); });
  it('a combined environment (both processes\' secrets) is refused by both, and the message never reveals the values', () => {
    const both = { ...publicBase, ...adminBase, API_ADMIN_PORT: '8788' };
    for (const load of [() => loadPublicConfig(both, { apiDir: API_DIR }), () => loadAdminConfig(both)]) {
      try { load(); throw new Error('NOT REFUSED'); } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        const text = (e as ConfigError).problems.join('|');
        for (const secret of [PW_PUBLIC, PW_ADMIN, '1'.repeat(64), '2'.repeat(64)]) expect(text).not.toContain(secret);
      }
    }
  });
  it('the public configuration object carries no admin credential or key, and the admin one no public credential', () => {
    const pub = JSON.stringify(loadPublicConfig(publicBase, { apiDir: API_DIR }));
    const adm = JSON.stringify(loadAdminConfig(adminBase));
    expect(pub).not.toContain(PW_ADMIN); expect(pub).not.toMatch(/hmac|totp|newscafe_admin/i);
    expect(adm).not.toContain(PW_PUBLIC); expect(adm).not.toMatch(/newscafe_public|outbox/i);
  });
});

describe('logging cannot leak personal data or secrets', () => {
  const capture = () => { const lines: string[] = []; return { lines, log: createLogger((l) => lines.push(l)) }; };
  it('writes only allow-listed fields', () => {
    const { lines, log } = capture();
    log.info('request', { request_id: 'abc', method: 'POST', route: '/api/reservations', status: 201, duration_ms: 5,
      email: 'guest@example.com', phone: '+27820000000', name: 'Jane', notes: 'allergy', password: 'x', token: 't', cookie: 'c', authorization: 'a', body: '{"x":1}' } as never);
    const out = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['duration_ms', 'event', 'level', 'method', 'request_id', 'route', 'status', 't']);
  });
  it('masks e-mail addresses and phone numbers even inside allowed fields', () => {
    const { lines, log } = capture();
    log.error('x', { reason: 'failed for guest@example.com or +27 82 000 0000', code: 'a@b.co' });
    expect(lines[0]).not.toMatch(/guest@example|27 82 000|a@b\.co/);
    expect(lines[0]).toContain('[masked]');
  });
  it('keeps the server-generated request id intact so support can quote it', () => {
    const { lines, log } = capture();
    log.info('request', { request_id: 'f90b38de-0ca4-4e96-989e-f2f875b1efde' });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ request_id: 'f90b38de-0ca4-4e96-989e-f2f875b1efde' });
  });
  it('caps long values', () => {
    const { lines, log } = capture();
    log.info('x', { reason: 'z'.repeat(5000) });
    expect(lines[0]!.length).toBeLessThan(400);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit inside the window, then refuses with a wait time, then recovers', () => {
    let t = 1_000_000; const r = new RateLimiter(100, () => t);
    for (let i = 0; i < 3; i++) expect(r.hit('a', 3, 60_000).allowed).toBe(true);
    const blocked = r.hit('a', 3, 60_000);
    expect(blocked.allowed).toBe(false); expect(blocked.retryAfterSec).toBeGreaterThan(0); expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    expect(r.hit('b', 3, 60_000).allowed).toBe(true);        // other clients unaffected
    t += 60_001;
    expect(r.hit('a', 3, 60_000).allowed).toBe(true);
  });
  it('stays bounded without timers', () => {
    const r = new RateLimiter(50);
    for (let i = 0; i < 500; i++) r.hit('k' + i, 5, 60_000);
    expect(r.size).toBeLessThanOrEqual(50);
  });
});

describe('error mapping (safe answers, never database text)', () => {
  const cfg = { contact: { phone: '+27 11 000 0000', email: 'info@example.com' } };
  const pgErr = (code: string) => Object.assign(new Error('secret database message with SELECT * FROM reservations'), { code });
  it.each([
    ['NC001', 503, 'not_configured'], ['NC002', 409, 'no_availability'], ['23P01', 409, 'no_availability'], ['NC004', 422, 'party_size_not_allowed'],
    ['NC005', 422, 'outside_booking_window'], ['NC006', 422, 'not_on_slot'], ['NC007', 422, 'closed'], ['NC008', 422, 'consent_required'],
    ['NC905', 409, 'idempotency_conflict'], ['22023', 422, 'invalid_input'], ['22P02', 422, 'invalid_input'],
    ['57014', 503, 'booking_unavailable'], ['57P01', 503, 'booking_unavailable'], ['53300', 503, 'booking_unavailable'], ['55P03', 503, 'booking_unavailable'],
    ['XX000', 500, 'internal_error'], ['42501', 500, 'internal_error'], ['NC900', 500, 'internal_error'],
  ])('%s -> %i %s', (state, status, code) => {
    const f = mapDbFailure(pgErr(state), cfg);
    expect(f.status).toBe(status); expect(f.body['error']).toBe(code);
    expect(JSON.stringify(f.body)).not.toMatch(/SELECT|reservations|secret database/);
  });
  it('tells the website to use request mode when the database is unreachable, and attaches contact details', () => {
    for (const e of [new DbUnavailable('connect'), new DbEnvironmentRefused()]) {
      const f = mapDbFailure(e, cfg);
      expect(f.status).toBe(503); expect(f.body['fallback']).toBe('request'); expect(f.body['contact']).toEqual({ phone: '+27 11 000 0000', email: 'info@example.com' });
    }
  });
  it('reports an uncertain outcome honestly (never "saved", never "failed for sure")', () => {
    const f = mapDbFailure(new DbOutcomeUnknown(), cfg);
    expect(f.status).toBe(503); expect(f.body['error']).toBe('outcome_unknown'); expect(f.body['outcome']).toBe('unknown'); expect(f.body['retry_with_same_key']).toBe(true);
  });
  it('treats Node network errors as non-SQL (EPIPE is not a SQLSTATE)', () => {
    expect(sqlstateOf({ code: 'EPIPE' })).toBeNull(); expect(sqlstateOf({ code: 'ECONNREFUSED' })).toBeNull(); expect(sqlstateOf({ code: 'NC002' })).toBe('NC002');
  });
  it('omits contact details that are not configured', () => {
    expect(mapDbFailure(new DbUnavailable('x'), { contact: { phone: null, email: null } }).body['contact']).toBeUndefined();
  });
});

describe('input schemas', () => {
  const ok = { party_size: 2, starts_at: '2026-12-04T19:00:00+02:00', name: 'Jane Doe', email: 'jane@example.com', phone: '+27 82 000 0000', consent: true };
  const parse = (over: Record<string, unknown>) => ReservationBody.safeParse({ ...ok, ...over });
  it('accepts a normal request, and either contact method alone', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ phone: undefined }).success).toBe(true);
    expect(parse({ email: undefined }).success).toBe(true);
    expect(parse({ email: '', notes: 'Window seat\nthanks' }).success).toBe(true);
  });
  it('trims text', () => { const r = parse({ name: '  Jane  ' }); expect(r.success && r.data.name).toBe('Jane'); });
  it.each([
    ['no contact method', { email: undefined, phone: undefined }], ['empty name', { name: '   ' }], ['name too long', { name: 'x'.repeat(101) }],
    ['name with control character', { name: 'Jane\u0000Doe' }], ['name with newline', { name: 'Jane\nDoe' }], ['notes too long', { notes: 'x'.repeat(501) }],
    ['notes with control character', { notes: 'a\u0007b' }], ['bad email', { email: 'not-an-email' }], ['email too long', { email: 'a'.repeat(250) + '@b.co' }],
    ['bad phone', { phone: 'call me maybe' }], ['party 0', { party_size: 0 }], ['party 100', { party_size: 100 }], ['party 2.5', { party_size: 2.5 }],
    ['party as text', { party_size: '2' }], ['no timezone offset', { starts_at: '2026-12-04T19:00:00' }], ['date only', { starts_at: '2026-12-04' }],
    ['garbage time', { starts_at: 'tomorrow evening' }], ['consent false', { consent: false }], ['consent missing', { consent: undefined }],
    ['consent as text', { consent: 'true' }],
  ])('rejects %s', (_label, over) => { expect(parse(over).success).toBe(false); });
  it.each(['status', 'source', 'is_test', 'consent_at', 'id', 'reference', 'location_id', 'table_id', 'auto_confirm', 'actor', 'created_at', '__proto__'])(
    'rejects a client-supplied "%s" (mass assignment)', (field) => {
      const body = JSON.parse(JSON.stringify({ ...ok })) as Record<string, unknown>;
      Object.defineProperty(body, field, { value: 'confirmed', enumerable: true });
      expect(ReservationBody.safeParse(body).success).toBe(false);
    });
  it('validates availability queries strictly', () => {
    expect(AvailabilityQuery.safeParse({ date: '2026-12-04', party: '2' }).success).toBe(true);
    for (const q of [{ date: '2026-02-30', party: '2' }, { date: '04-12-2026', party: '2' }, { date: '2026-12-04', party: '0' }, { date: '2026-12-04', party: '100' },
      { date: '2026-12-04', party: 'x' }, { date: '2026-12-04', party: '2', extra: '1' }, { party: '2' }, { date: "2026-12-04'; DROP TABLE reservations;--", party: '2' }]) {
      expect(AvailabilityQuery.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
  });
});
