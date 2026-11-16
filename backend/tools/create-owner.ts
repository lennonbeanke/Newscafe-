// Developer-run script: creates the FAKE development owner account. Run through backend/scripts/create-owner.sh (never directly).
//   * only for the local development database; refuses anything else
//   * only an address ending in @example.invalid (a real owner account is NOT created here: that is a later, separately approved step)
//   * only if no owner exists yet
//   * the random password is shown ONCE on the terminal; it is never written to a file, a log or Git; only its Argon2id hash is stored
//   * two-factor is set up by the owner at the first sign-in
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { defaultTuning } from '../src/config.ts';
import { checkNewPassword, hashPassword } from '../src/auth/password.ts';

const need = (name: string): string => { const v = process.env[name]; if (!v) { process.stderr.write(`Refused: ${name} is missing.\n`); process.exit(1); } return v; };
const refuse = (why: string): never => { process.stderr.write(`Refused: ${why}\n`); process.exit(1); };

const host = need('CREATE_OWNER_DB_HOST'); const port = Number(need('CREATE_OWNER_DB_PORT')); const database = need('CREATE_OWNER_DB_NAME');
const user = need('CREATE_OWNER_DB_USER'); const password = need('CREATE_OWNER_DB_PASSWORD');
if (!['127.0.0.1', 'localhost'].includes(host)) refuse('the database must be on this computer.');
if (!/^newscafe_(dev|test[a-z0-9_]*)$/.test(database)) refuse('the database must be newscafe_dev or newscafe_test*.');
if (process.env['NODE_ENV'] === 'production' || process.env['APP_ENV'] !== 'development') refuse('this script only runs in the development setup.');
const email = (process.argv[2] ?? 'dev-owner@example.invalid').trim().toLowerCase();
if (!/^[a-z0-9._+-]+@example\.invalid$/.test(email)) refuse('only a fake development address ending in @example.invalid can be created here. A real owner account is a separate step that needs your written approval.');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const groups = Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
const newPassword = groups.join('-');           // 24 random characters (about 140 bits)

const c = new pg.Client({ host, port, database, user, password });
await c.connect();
try {
  const env = (await c.query<{ env: string }>('SELECT env FROM app_environment')).rows[0]?.env;
  if (env !== 'development') refuse(`the database is labelled "${String(env)}", not development.`);
  const existing = (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM admin_users')).rows[0]?.n;
  if (existing !== '0') refuse('an owner account already exists. This script only creates the first fake development owner.');
  const weak = checkNewPassword(newPassword, email);   // new owner accounts need a password of at least 12 characters
  if (weak) refuse(weak + '.');
  const hash = await hashPassword(newPassword, defaultTuning.argon2);
  await c.query(`INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, 'owner')`, [email, hash]);
} finally { await c.end(); }

process.stdout.write(`
Fake development owner created in ${database}.

  e-mail:    ${email}
  password:  ${newPassword}

This password is shown ONCE and is not stored anywhere (only its Argon2id hash is). Copy it now.
At the first sign-in you will be asked to set up an authenticator app and you will receive 10 recovery codes (also shown once).
`);
