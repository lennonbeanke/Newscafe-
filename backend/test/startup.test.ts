// The real server process: it refuses unsafe configuration, starts without the database, and stops cleanly.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testAdminEnv, testPublicEnv } from './helpers/fixtures.ts';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = (): number => 20_000 + Math.floor(Math.random() * 20_000);

/** Listening sockets for a port, from the OS (lsof on POSIX, netstat on Windows). */
function listenersOn(port: number): string {
  if (process.platform === 'win32') {
    return execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /LISTENING/i.test(line) && (line.trim().split(/\s+/)[1] ?? '').endsWith(`:${port}`))
      .map((line) => line.trim().split(/\s+/)[1] ?? '').join('\n');
  }
  return execFileSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
}

/** On Windows a SIGTERM sent by kill() cannot run the handler (the OS ends the process); graceful shutdown is POSIX-only. */
function expectStopped(p: { out(): string; exited: Promise<number | null> }, code: number | null): void {
  if (process.platform === 'win32') { expect(code === 0 || code === null).toBe(true); return; }
  expect(code).toBe(0);
  expect(p.out()).toContain('shutting_down');
}

function run(env: Record<string, string | undefined>, opts: { waitFor?: RegExp; timeoutMs?: number; entry?: string } = {}) {
  const clean: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const child = spawn(process.execPath, [opts.entry ?? 'src/server-public.ts'], { cwd: apiDir, env: clean });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { err += String(d); });
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for the server: ' + out + err)), opts.timeoutMs ?? 8000);
    const check = setInterval(() => { if (opts.waitFor?.test(out)) { clearInterval(check); clearTimeout(timer); resolve(); } }, 50);
    void exited.then(() => { clearInterval(check); clearTimeout(timer); resolve(); });
  });
  return { child, ready, exited, out: () => out, err: () => err };
}

describe('server process', () => {
  it('refuses to start in a production-like configuration and never prints a secret', async () => {
    const env = testPublicEnv({ APP_ENV: 'production', API_PORT: String(freePort()), DATABASE_URL: 'postgres://user:hunter2@evil.example/db' });
    const p = run(env);
    await p.ready;
    expect(await p.exited).toBe(1);
    expect(p.err()).toMatch(/Startup refused/); expect(p.err()).toMatch(/APP_ENV/); expect(p.err()).toMatch(/DATABASE_URL/);
    expect(p.out() + p.err()).not.toMatch(/hunter2|evil\.example/);
    expect(p.out() + p.err()).not.toContain(String(env['API_DB_PUBLIC_PASSWORD']));
  });
  it('refuses a remote database host', async () => {
    const p = run(testPublicEnv({ API_DB_HOST: '203.0.113.7', API_PORT: String(freePort()) }));
    await p.ready; expect(await p.exited).toBe(1); expect(p.err()).toMatch(/API_DB_HOST/);
  });
  it('starts even when the database is down, answers "request only", then shuts down cleanly on SIGTERM', async () => {
    const port = freePort();
    const p = run(testPublicEnv({ API_PORT: String(port), API_DB_PORT: '1999' + String(1 + Math.floor(Math.random() * 8)) }), { waitFor: /"event":"listening"/ });
    await p.ready;
    expect(p.out()).toContain('"event":"listening"');
    try {
      const h = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(await h.json()).toEqual({ status: 'ok', booking: 'request_only' });
      const a = await fetch(`http://127.0.0.1:${port}/api/availability?date=2030-01-10&party=2`);
      expect(a.status).toBe(503); expect(((await a.json()) as Record<string, unknown>)['fallback']).toBe('request');
    } finally { p.child.kill('SIGTERM'); }
    expectStopped(p, await p.exited);
    expect(p.out()).not.toContain(String(testPublicEnv()['API_DB_PUBLIC_PASSWORD']));
  });
  it('with the database up it reports booking "available" and listens on the loopback address only', async () => {
    const port = freePort();
    const p = run(testPublicEnv({ API_PORT: String(port) }), { waitFor: /"event":"listening"/ });
    await p.ready;
    try {
      const h = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(await h.json()).toEqual({ status: 'ok', booking: 'available' });
      const listeners = listenersOn(port);
      expect(listeners).toContain('127.0.0.1:' + port); expect(listeners).not.toMatch(/\*:|0\.0\.0\.0|\[::\]/);
    } finally { p.child.kill('SIGTERM'); }
    expectStopped(p, await p.exited);
  });
});

describe('admin server process', () => {
  it('refuses to start if it can see the PUBLIC process\'s secrets, and never prints a value', async () => {
    const env = testAdminEnv({ API_ADMIN_PORT: String(freePort()), API_DB_PUBLIC_PASSWORD: 'p'.repeat(40), API_PORT: '8787' });
    const p = run(env, { entry: 'src/server-admin.ts' }); await p.ready;
    expect(await p.exited).toBe(1);
    expect(p.err()).toMatch(/API_DB_PUBLIC_PASSWORD/); expect(p.out() + p.err()).not.toContain('p'.repeat(40));
    expect(p.out() + p.err()).not.toContain(String(env['API_DB_ADMIN_PASSWORD'])); expect(p.out() + p.err()).not.toContain(String(env['API_HMAC_KEY']));
  });
  it('the PUBLIC server process refuses to start if it can see an admin secret (same, from the other side)', async () => {
    const env = testPublicEnv({ API_PORT: String(freePort()), API_DB_ADMIN_PASSWORD: 'a'.repeat(40), API_HMAC_KEY: '3'.repeat(64) });
    const p = run(env); await p.ready;
    expect(await p.exited).toBe(1); expect(p.err()).toMatch(/API_DB_ADMIN_PASSWORD/); expect(p.err()).toMatch(/API_HMAC_KEY/);
    expect(p.out() + p.err()).not.toContain('a'.repeat(40)); expect(p.out() + p.err()).not.toContain('3'.repeat(64));
  });
  it('refuses a remote database host and a production-like setting', async () => {
    const a = run(testAdminEnv({ API_ADMIN_PORT: String(freePort()), API_DB_HOST: '203.0.113.7' }), { entry: 'src/server-admin.ts' }); await a.ready;
    expect(await a.exited).toBe(1); expect(a.err()).toMatch(/API_DB_HOST/);
    const b = run(testAdminEnv({ API_ADMIN_PORT: String(freePort()), APP_ENV: 'production' }), { entry: 'src/server-admin.ts' }); await b.ready;
    expect(await b.exited).toBe(1); expect(b.err()).toMatch(/APP_ENV/);
  });
  it('starts, listens on the loopback address only, serves only admin routes, and stops cleanly', async () => {
    const port = freePort();
    const p = run(testAdminEnv({ API_ADMIN_PORT: String(port) }), { entry: 'src/server-admin.ts', waitFor: /"event":"listening"/ }); await p.ready;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/api/admin/me`)).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/api/admin/reservations`)).status).toBe(401);
      const noOrigin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(noOrigin.status).toBe(403);
      const listeners = listenersOn(port);
      expect(listeners).toContain('127.0.0.1:' + port); expect(listeners).not.toMatch(/\*:|0\.0\.0\.0|\[::\]/);
    } finally { p.child.kill('SIGTERM'); }
    expectStopped(p, await p.exited);
    expect(p.out() + p.err()).not.toContain(String(testAdminEnv()['API_DB_ADMIN_PASSWORD']));
    expect(p.out() + p.err()).not.toContain(String(testAdminEnv()['API_HMAC_KEY']));
  });
  it('starts even when the database is down; sign-in then answers 503 (never 401)', async () => {
    const port = freePort();
    const p = run(testAdminEnv({ API_ADMIN_PORT: String(port), API_DB_PORT: '1999' + String(1 + Math.floor(Math.random() * 8)) }), { entry: 'src/server-admin.ts', waitFor: /"event":"listening"/ }); await p.ready;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-requested-with': 'newscafe-admin' }, body: JSON.stringify({ email: 'a@example.invalid', password: 'wrong-password-xx' }) });
      expect(r.status).toBe(503);
    } finally { p.child.kill('SIGTERM'); }
    expectStopped(p, await p.exited);
  });
});
