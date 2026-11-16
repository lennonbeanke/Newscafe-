// Startup configuration and safety guards. The API refuses to start (fail closed) unless it is clearly the local DEVELOPMENT
// setup. Messages name the setting, never its value, so a secret can never end up in a log.
//
// CREDENTIAL ISOLATION: the API is two separate processes with two separate env files.
//   public process (src/server-public.ts): holds ONLY the public database login. loadPublicConfig() refuses to start if it can
//                                          see the admin password, either key, or the admin port.
//   admin process  (src/server-admin.ts):  holds ONLY the admin database login plus the two keys. loadAdminConfig() refuses to
//                                          start if it can see the public password or the public port/outbox.
// So a flaw in anything that handles public requests cannot reach the admin credentials: they are not in that process.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Argon2Params { readonly memoryCost: number; readonly timeCost: number; readonly parallelism: number }

export interface Tuning {
  readonly dbConnectTimeoutMs: number;   // connect / wait-for-pool limit
  readonly dbQueryTimeoutMs: number;     // client-side limit (the database roles also have a 5 s / 10 s statement timeout)
  readonly dbCooldownMs: number;         // after a connection failure, fail fast for this long, then try again
  readonly healthOkTtlMs: number;        // /health answers from cache for this long while the database is up
  readonly healthDownTtlMs: number;      // ...and for this long while it is down (so recovery is noticed quickly)
  readonly availabilityTtlMs: number;    // short cache of availability answers (0 = off)
  readonly poolMax: number;              // below the database role's own connection limit (public 20, admin 10)
  readonly bodyLimitBytes: number;
  readonly argon2: Argon2Params;         // owner password hashing (admin process only)
  readonly sessionAbsoluteSeconds: number;  // a signed-in session never lasts longer than this
  readonly sessionIdleSeconds: number;      // ...and ends after this long without a request
  readonly lockoutFailures: number;         // consecutive failures that lock the account
  readonly lockoutSeconds: number;
}

export const defaultTuning: Tuning = {
  dbConnectTimeoutMs: 2000,
  dbQueryTimeoutMs: 6000,
  dbCooldownMs: 3000,
  healthOkTtlMs: 30_000,
  healthDownTtlMs: 5_000,
  availabilityTtlMs: 10_000,
  poolMax: 8,
  bodyLimitBytes: 16 * 1024,
  argon2: { memoryCost: 65_536, timeCost: 3, parallelism: 1 },   // 64 MiB, 3 passes (above the OWASP minimum)
  sessionAbsoluteSeconds: 12 * 60 * 60,
  sessionIdleSeconds: 30 * 60,
  lockoutFailures: 5,
  lockoutSeconds: 15 * 60,
};

interface BaseConfig {
  readonly env: 'development';
  readonly host: '127.0.0.1';
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbName: string;
  readonly venueTimeZone: string;
  readonly tuning: Tuning;
}
export interface PublicConfig extends BaseConfig {
  readonly kind: 'public';
  readonly port: number;
  readonly dbUser: 'newscafe_public';
  readonly dbPassword: string;
  readonly allowedOrigin: string;
  readonly outboxDir: string;
  readonly contact: { readonly phone: string | null; readonly email: string | null };
}
export interface AdminConfig extends BaseConfig {
  readonly kind: 'admin';
  readonly port: number;
  readonly dbUser: 'newscafe_admin';
  readonly dbPassword: string;
  readonly hmacKey: Buffer;
  readonly allowedOrigin: string;       // the dashboard's origin: the only site allowed to call the admin API
  readonly secureCookies: boolean;      // false only for plain-http local development
}

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Startup refused: ${problems.length} configuration problem(s)`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

// Settings that could silently redirect the database connection to another server: never accepted.
const FORBIDDEN_AMBIENT = ['DATABASE_URL', 'PGHOST', 'PGHOSTADDR', 'PGDATABASE', 'PGSERVICE', 'PGUSER', 'PGPASSWORD', 'PGPORT', 'PGSSLMODE'];
const HEX64 = /^[0-9a-f]{64}$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

class Reader {
  readonly problems: string[] = [];
  readonly env: Env;
  constructor(env: Env) { this.env = env; }
  need(name: string): string {
    const v = this.env[name];
    if (v === undefined || v === '') { this.problems.push(`${name} is missing`); return ''; }
    return v;
  }
  int(name: string, min: number, max: number): number {
    const raw = this.need(name);
    const n = Number(raw);
    if (raw !== '' && (!Number.isInteger(n) || n < min || n > max)) this.problems.push(`${name} must be a whole number from ${min} to ${max}`);
    return n;
  }
  /** Settings that belong to the OTHER process must not be present at all. */
  mustBeAbsent(names: readonly string[], why: string): void {
    for (const n of names) if (this.env[n] !== undefined && this.env[n] !== '') this.problems.push(`${n} must not be set here: ${why}`);
  }
  common(): { dbHost: string; dbPort: number; dbName: string } {
    for (const name of FORBIDDEN_AMBIENT) {
      if (this.env[name] !== undefined && this.env[name] !== '') this.problems.push(`${name} is set in the environment; the API only uses its own explicit settings`);
    }
    if (this.env['NODE_ENV'] === 'production') this.problems.push('NODE_ENV=production is not allowed: this build is development-only');
    if (this.need('APP_ENV') !== '' && this.env['APP_ENV'] !== 'development') this.problems.push("APP_ENV must be 'development'");
    const dbHost = this.need('API_DB_HOST');
    if (dbHost !== '' && !LOCAL_HOSTS.has(dbHost)) this.problems.push('API_DB_HOST must be 127.0.0.1 or localhost (the API never connects to another machine)');
    const dbPort = this.int('API_DB_PORT', 1024, 65535);
    const dbName = this.need('API_DB_NAME');
    if (dbName !== '' && !/^newscafe_(dev|test[a-z0-9_]*)$/.test(dbName)) this.problems.push('API_DB_NAME must be newscafe_dev or newscafe_test*');
    return { dbHost, dbPort, dbName };
  }
  password(name: string): string {
    const v = this.need(name);
    if (v !== '' && v.length < 32) this.problems.push(`${name} must be at least 32 characters`);
    return v;
  }
  localOrigin(name: string): string {
    let origin = this.need(name);
    if (origin !== '') {
      try {
        const u = new URL(origin);
        if (u.protocol !== 'http:' || !LOCAL_HOSTS.has(u.hostname) || u.origin !== origin) throw new Error('bad');
        origin = u.origin;
      } catch { this.problems.push(`${name} must be a local http origin such as http://localhost:3000 (no path)`); }
    }
    return origin;
  }
  finish(): void { if (this.problems.length > 0) throw new ConfigError(this.problems); }
}

export function loadPublicConfig(env: Env, options: { apiDir?: string; tuning?: Partial<Tuning> } = {}): PublicConfig {
  const r = new Reader(env);
  r.mustBeAbsent(['API_DB_ADMIN_USER', 'API_DB_ADMIN_PASSWORD', 'API_HMAC_KEY', 'API_TOTP_ENC_KEY', 'API_ADMIN_PORT', 'API_ADMIN_ALLOWED_ORIGIN'],
    'the public process must never hold admin credentials or keys');
  const { dbHost, dbPort, dbName } = r.common();
  const port = r.int('API_PORT', 1024, 65535);
  const user = r.need('API_DB_PUBLIC_USER');
  if (user !== '' && user !== 'newscafe_public') r.problems.push('API_DB_PUBLIC_USER must be newscafe_public (never a superuser or owner account)');
  const password = r.password('API_DB_PUBLIC_PASSWORD');
  const allowedOrigin = r.localOrigin('API_ALLOWED_ORIGIN');

  const apiDir = options.apiDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outboxRaw = r.need('API_OUTBOX_DIR');
  let outboxDir = '';
  if (outboxRaw !== '') {
    // "backend/.outbox" is relative to the project root; accept it relative to backend/ too. It must stay inside backend/.
    const rel = outboxRaw === 'backend' ? '.' : outboxRaw.replace(/^backend\//, '');
    outboxDir = path.resolve(apiDir, rel);
    if (path.isAbsolute(outboxRaw) || !(outboxDir === apiDir || outboxDir.startsWith(apiDir + path.sep)) || outboxDir === apiDir) {
      r.problems.push('API_OUTBOX_DIR must be a folder inside backend/');
    }
  }
  const phone = env['API_CONTACT_PHONE'] ?? '';
  const email = env['API_CONTACT_EMAIL'] ?? '';
  if (phone !== '' && !/^[0-9+() -]{5,30}$/.test(phone)) r.problems.push('API_CONTACT_PHONE is not a valid phone number');
  if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) r.problems.push('API_CONTACT_EMAIL is not a valid e-mail address');
  r.finish();

  return Object.freeze<PublicConfig>({
    kind: 'public', env: 'development', host: '127.0.0.1',   // fixed: never reachable from another machine
    port, dbHost, dbPort, dbName, dbUser: 'newscafe_public', dbPassword: password,
    allowedOrigin, outboxDir, venueTimeZone: 'Africa/Johannesburg',
    contact: { phone: phone || null, email: email || null },
    tuning: { ...defaultTuning, ...options.tuning },
  });
}

export function loadAdminConfig(env: Env, options: { tuning?: Partial<Tuning> } = {}): AdminConfig {
  const r = new Reader(env);
  r.mustBeAbsent(['API_DB_PUBLIC_USER', 'API_DB_PUBLIC_PASSWORD', 'API_PORT', 'API_OUTBOX_DIR', 'API_ALLOWED_ORIGIN', 'API_CONTACT_PHONE', 'API_CONTACT_EMAIL'],
    'the admin process must not hold public-process settings');
  const { dbHost, dbPort, dbName } = r.common();
  const port = r.int('API_ADMIN_PORT', 1024, 65535);
  const user = r.need('API_DB_ADMIN_USER');
  if (user !== '' && user !== 'newscafe_admin') r.problems.push('API_DB_ADMIN_USER must be newscafe_admin (never a superuser or owner account)');
  const password = r.password('API_DB_ADMIN_PASSWORD');
  const hmac = r.need('API_HMAC_KEY');
  if (hmac !== '' && !HEX64.test(hmac)) r.problems.push('API_HMAC_KEY must be 64 hex characters (32 random bytes)');
  const allowedOrigin = r.localOrigin('API_ADMIN_ALLOWED_ORIGIN');
  r.finish();

  return Object.freeze<AdminConfig>({
    kind: 'admin', env: 'development', host: '127.0.0.1',
    port, dbHost, dbPort, dbName, dbUser: 'newscafe_admin', dbPassword: password,
    hmacKey: Buffer.from(hmac, 'hex'),
    allowedOrigin, secureCookies: false,   // plain http://localhost in development; production must set Secure (a later gate)
    venueTimeZone: 'Africa/Johannesburg',
    tuning: { ...defaultTuning, ...options.tuning },
  });
}
