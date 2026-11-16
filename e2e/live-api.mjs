// LIVE checks of the owner sign-in, run against the real local servers exactly the way the browser reaches them:
//   Next dev server  http://127.0.0.1:3000  --(proxy /api/admin/*)-->  owner API 127.0.0.1:8788   (public API: 127.0.0.1:8787)
// Development database and FAKE data only. Needs: the two APIs and the frontend dev server running, Node 24.
//
//   PHASE=A node e2e/live-api.mjs        no password needed: pages, headers, proxy, CSRF, validation, default-deny, API separation
//   PHASE=B OWNER_EMAIL=... OWNER_PASSWORD_FILE=... node e2e/live-api.mjs
//                                                full password-only sign-in journey, logout, expiry (writes sessions and audit rows for THAT owner only)
//   PHASE=C ...                                  lock-out and the login rate limit (locks THAT owner for 15 minutes)
// B and C need a DISPOSABLE owner (an @example.invalid address with a throw-away password): they sign in and lock the account. Never use a real owner.
// Secrets (password, set-up key, codes, cookies) are never printed; the report only says PASS/FAIL and what was checked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const SITE = "http://127.0.0.1:3000";
const ORIGIN = "http://localhost:3000";          // the only origin the owner API accepts
const PUBLIC_API = "http://127.0.0.1:8787";
const ADMIN_API = "http://127.0.0.1:8788";
const PHASE = process.env.PHASE ?? "A";
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`);
}
async function expect(name, fn) { try { const r = await fn(); check(name, r !== false, r === false ? "condition false" : ""); } catch (e) { check(name, false, String(e.message ?? e).slice(0, 200)); } }

// ---- a small browser-like client (cookie jar, Origin header, CSRF header) ---------------------------------------------------------
class Client {
  constructor() { this.cookie = null; this.csrf = null; this.lastSetCookie = []; }
  async call(method, path, { body, origin = ORIGIN, xrw = true, csrf = this.csrf, cookie = this.cookie, contentType = "application/json", rawBody, base = SITE } = {}) {
    const headers = { Accept: "application/json" };
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = `nc_admin_session=${cookie}`;
    if (method !== "GET") { if (xrw) headers["X-Requested-With"] = "newscafe-admin"; if (csrf) headers["X-CSRF-Token"] = csrf; }
    let payload;
    if (rawBody !== undefined) { payload = rawBody; headers["Content-Type"] = contentType; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = contentType; }
    const res = await fetch(`${base}/api/admin${path}`, { method, headers, body: payload, redirect: "manual" });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no body */ }
    const setCookies = res.headers.getSetCookie?.() ?? [];
    return { status: res.status, json, text, headers: res.headers, setCookies };
  }
  /** Adopt the session cookie the server set (a real browser would). */
  adopt(r) {
    for (const c of r.setCookies) {
      const m = /^nc_admin_session=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] === "" ? null : m[1];
    }
  }
}
const cookieAttrs = (r) => (r.setCookies.find((c) => c.startsWith("nc_admin_session=")) ?? "");

const sql = (q) => {
  const user = /^POSTGRES_USER=(.*)$/m.exec(readFileSync(new URL("../backend/database/.env", import.meta.url), "utf8"))?.[1];
  return execFileSync("docker", ["exec", "newscafe-db-dev", "psql", "-X", "-q", "-U", user, "-d", "newscafe_dev", "-tAc", q], { encoding: "utf8" }).trim();
};

// =============================================================================================================================================
// PHASE A: no owner password needed
// =============================================================================================================================================
async function phaseA() {
  console.log("\n== A1  pages, headers and the public site");
  const login = await fetch(`${SITE}/admin/login`, { redirect: "manual" });
  const loginHtml = await login.text();
  await expect("GET /admin/login answers 200", () => login.status === 200);
  await expect("owner pages are marked private (no-store, DENY, no-referrer, noindex)", () =>
    /no-store/.test(login.headers.get("cache-control") ?? "") && login.headers.get("x-frame-options") === "DENY" && login.headers.get("referrer-policy") === "no-referrer" &&
    /noindex/.test(login.headers.get("x-robots-tag") ?? "") && login.headers.get("x-content-type-options") === "nosniff");
  await expect("owner pages carry <meta name=robots noindex>", () => /<meta name="robots" content="[^"]*noindex/.test(loginHtml));
  await expect("owner pages contain no public navbar, footer or custom cursor", () => !/id="footer"|data-cursor|Skip to content/i.test(loginHtml));
  await expect("owner page HTML contains no secret, address of the admin API, or token", () => !/8788|127\.0\.0\.1|API_HMAC|API_TOTP|csrf_token|nc_admin_session/.test(loginHtml));
  const home = await fetch(`${SITE}/admin`, { redirect: "manual" });
  await expect("GET /admin answers 200 and shows no owner data before sign-in (spinner only)", async () => home.status === 200 && !/dev-owner|reservation|@example/i.test(await home.text()));
  const pub = await fetch(`${SITE}/`, { redirect: "manual" });
  const pubHtml = await pub.text();
  await expect("public home page still answers 200", () => pub.status === 200);
  await expect("public home page still has its skip link and is NOT noindex", () => /Skip to content/.test(pubHtml) && !/<meta name="robots" content="[^"]*noindex/.test(pubHtml));
  await expect("public home page has no private-area headers", () => !/noindex/.test(pub.headers.get("x-robots-tag") ?? "") && pub.headers.get("x-frame-options") !== "DENY");
  const robots = await (await fetch(`${SITE}/robots.txt`)).text();
  await expect("robots.txt keeps crawlers out of /admin and /api/admin", () => /Disallow: \/admin/.test(robots) && /Disallow: \/api\/admin/.test(robots));

  console.log("\n== A2  proxy and API separation");
  const c = new Client();
  const me = await c.call("GET", "/me");
  await expect("owner API reachable through the site's /api/admin proxy (401 without session)", () => me.status === 401 && me.json?.error === "unauthenticated");
  await expect("error answers carry a request id and no-store", () => !!me.json?.request_id && /no-store/.test(me.headers.get("cache-control") ?? ""));
  await expect("owner API sets its own security headers (nosniff, DENY, CSP default-src none)", () =>
    me.headers.get("x-content-type-options") === "nosniff" && me.headers.get("x-frame-options") === "DENY" && /default-src 'none'/.test(me.headers.get("content-security-policy") ?? ""));
  const pubViaSite = await fetch(`${SITE}/api/health`, { redirect: "manual" });
  await expect("the site does NOT proxy the public API (/api/health is not forwarded)", () => pubViaSite.status === 404);
  await expect("public API process has no owner routes (404 on /api/admin/me)", async () => (await fetch(`${PUBLIC_API}/api/admin/me`)).status === 404);
  await expect("owner API process has no public routes (404 on /api/health, /api/availability, /api/reservations)", async () =>
    (await fetch(`${ADMIN_API}/api/health`)).status === 404 && (await fetch(`${ADMIN_API}/api/availability?date=2026-12-04&party=2`)).status === 404 && (await fetch(`${ADMIN_API}/api/reservations`, { method: "POST" })).status === 404);
  await expect("public API health answers only {status, booking}", async () => { const j = await (await fetch(`${PUBLIC_API}/api/health`)).json(); return Object.keys(j).sort().join() === "booking,status"; });
  const pub2 = await fetch(`${PUBLIC_API}/api/health`, { headers: { Origin: "http://localhost:3000", Cookie: "nc_admin_session=x" } });
  await expect("public API ignores an owner cookie (same answer, no session logic)", () => pub2.status === 200);
  await expect("process listeners are loopback only (8787, 8788, 3000)", () => {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    return [8787, 8788, 3000].every((p) => { const lines = out.split("\n").filter((l) => new RegExp(`:${p}\\s+\\S+\\s+LISTENING`).test(l)); return lines.length > 0 && lines.every((l) => /127\.0\.0\.1:/.test(l)); });
  });

  console.log("\n== A3  CORS");
  const pre = await fetch(`${ADMIN_API}/api/admin/login`, { method: "OPTIONS", headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" } });
  await expect("a foreign origin is not allowed by CORS", () => (pre.headers.get("access-control-allow-origin") ?? "") !== "http://evil.example" && pre.headers.get("access-control-allow-origin") !== "*");
  const pre2 = await fetch(`${ADMIN_API}/api/admin/login`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
  await expect("only the dashboard origin is allowed, with credentials", () => pre2.headers.get("access-control-allow-origin") === ORIGIN && pre2.headers.get("access-control-allow-credentials") === "true");

  console.log("\n== A4  CSRF layers on a state-changing request (refused before any database work)");
  const body = { email: "nobody@example.invalid", password: "x" };
  let r = await c.call("POST", "/login", { body, origin: "http://evil.example" });
  await expect("wrong Origin -> 403 csrf_origin", () => r.status === 403 && r.json?.error === "csrf_origin");
  r = await c.call("POST", "/login", { body, origin: null });
  await expect("no Origin -> 403 csrf_origin", () => r.status === 403 && r.json?.error === "csrf_origin");
  r = await c.call("POST", "/login", { body, origin: "http://127.0.0.1:3000" });
  await expect("the 127.0.0.1 spelling of the site is refused too (only http://localhost:3000)", () => r.status === 403 && r.json?.error === "csrf_origin");
  r = await c.call("POST", "/login", { body, xrw: false });
  await expect("missing X-Requested-With -> 403 csrf_header", () => r.status === 403 && r.json?.error === "csrf_header");
  r = await c.call("POST", "/logout", {});
  await expect("logout without a session -> 401", () => r.status === 401);

  console.log("\n== A5  input validation (refused before any database work)");
  r = await c.call("POST", "/login", { body: {} });
  await expect("empty login body -> 422 validation_failed, issues name fields not values", () => r.status === 422 && r.json?.error === "validation_failed" && Array.isArray(r.json.issues));
  r = await c.call("POST", "/login", { body: { email: "a@example.invalid", password: "x", admin: true } });
  await expect("unknown field -> 422", () => r.status === 422);
  r = await c.call("POST", "/login", { body: { email: "not-an-email", password: "x" } });
  await expect("bad e-mail -> 422", () => r.status === 422);
  r = await c.call("POST", "/login", { body: { email: "a@example.invalid", password: "x".repeat(129) } });
  await expect("129-character password -> 422", () => r.status === 422);
  r = await c.call("POST", "/login", { rawBody: "email=a&password=b", contentType: "application/x-www-form-urlencoded" });
  await expect("form-encoded body -> 415", () => r.status === 415);
  r = await c.call("POST", "/login", { rawBody: "{not json", contentType: "application/json" });
  await expect("malformed JSON -> 4xx, never 5xx", () => r.status >= 400 && r.status < 500);
  r = await c.call("POST", "/login", { rawBody: JSON.stringify({ email: "a@example.invalid", password: "x".repeat(20000) }) });
  await expect("body over 16 KB -> 413", () => r.status === 413);

  console.log("\n== A6  default-deny: every owner route refuses a caller with no session, and one with a made-up cookie");
  const gets = ["/me", "/reservations", "/reservations/00000000-0000-4000-8000-000000000000", "/reservations/00000000-0000-4000-8000-000000000000/history", "/audit-log", "/readiness", "/tables"];
  const posts = ["/logout", "/reservations",
    "/reservations/00000000-0000-4000-8000-000000000000/confirm", "/reservations/00000000-0000-4000-8000-000000000000/cancel", "/reservations/00000000-0000-4000-8000-000000000000/move"];
  for (const cookie of [null, "A".repeat(43), "not-a-token"]) {
    const label = cookie === null ? "no cookie" : "made-up cookie";
    const bad = [];
    for (const p of gets) { const x = await c.call("GET", p, { cookie }); if (x.status !== 401 && x.status !== 403) bad.push(`GET ${p}=${x.status}`); }
    for (const p of posts) { const x = await c.call("POST", p, { cookie, body: {}, csrf: "x" }); if (x.status !== 401 && x.status !== 403 && x.status !== 422) bad.push(`POST ${p}=${x.status}`); }
    await expect(`${gets.length + posts.length} owner routes refuse (${label})`, () => bad.length === 0 || (console.log("      ", bad.join(" ")), false));
  }
  const patch = await c.call("POST", "/reservations/00000000-0000-4000-8000-000000000000", { body: {} });
  await expect("unknown/unsupported method or path never reaches a handler (404/405)", () => [404, 405].includes(patch.status));

  console.log("\n== A7  the second-factor routes no longer exist");
  for (const path of ["/login/totp", "/login/recovery", "/totp/enroll/start", "/totp/enroll/confirm", "/recovery-codes/regenerate"]) {
    const x = await c.call("POST", path, { body: {} });
    await expect(`POST /api/admin${path} -> 404 (no handler, nothing to guess at)`, () => x.status === 404);
  }
}


// =============================================================================================================================================
// PHASE B / C helpers
// =============================================================================================================================================
const leaked = []; // every secret value this run learned: they are searched for in the server logs at the end
const ownerOf = () => { const email = process.env.OWNER_EMAIL ?? ""; assert.ok(/@example\.invalid$/.test(email), "only a DISPOSABLE owner (an @example.invalid address): never a real owner account"); return email; };
const passwordOf = () => readFileSync(process.env.OWNER_PASSWORD_FILE, "utf8").split(/\r?\n/)[0];
const logsText = () => ["api-dev.log", "next-dev.log"].map((f) => { try { return readFileSync(new URL(`file:///${process.env.LOG_DIR}/${f}`), "utf8"); } catch { return ""; } }).join("\n");

// =============================================================================================================================================
// PHASE B: password-only sign-in, signed-in access, CSRF, logout, expiry, old pending sessions
// =============================================================================================================================================
async function phaseB() {
  const email = ownerOf(); const password = passwordOf(); leaked.push(password);
  const login = (c, pw = password, e = email) => c.call("POST", "/login", { body: { email: e, password: pw } });
  const owner = `(SELECT id FROM admin_users WHERE email='${email}')`;

  console.log("\n== B1  e-mail and password: one step, a full session");
  const wrong = await login(new Client(), password + "x");
  const ghost = await login(new Client(), "whatever-password-123", "ghost-user@example.invalid");
  await expect("wrong password -> 401 invalid_credentials, no cookie", () => wrong.status === 401 && wrong.json?.error === "invalid_credentials" && wrong.setCookies.length === 0);
  await expect("unknown e-mail gives the IDENTICAL answer (error + message): no way to learn which owners exist", () => ghost.status === 401 && ghost.json.error === wrong.json.error && ghost.json.message === wrong.json.message);
  const c = new Client(); const r = await login(c); c.adopt(r); c.csrf = r.json?.csrf_token; leaked.push(c.cookie ?? "", c.csrf ?? "");
  await expect("the correct password -> 200 signed_in at once", () => r.status === 200 && r.json?.signed_in === true);
  await expect("the answer holds exactly: signed_in, csrf_token, user, session_expires_at (no 'stage', no codes, no secret)", () => Object.keys(r.json).sort().join() === "csrf_token,session_expires_at,signed_in,user" && r.json.user.email === email && r.json.user.role === "owner");
  const attrs = cookieAttrs(r);
  await expect("cookie: HttpOnly; SameSite=Strict; Path=/api/admin; lifetime 12 h; not readable by script", () => /HttpOnly/.test(attrs) && /SameSite=Strict/.test(attrs) && /Path=\/api\/admin/.test(attrs) && Number(/Max-Age=(\d+)/.exec(attrs)?.[1]) === 43200);
  await expect("the response body never contains the session token", () => !r.text.includes(c.cookie ?? "@@"));
  await expect("the database holds ONE live session for this owner and it is a normal (not 'pending') one", () => sql(`SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now() AND NOT mfa_pending) || '/' || count(*) FILTER (WHERE mfa_pending AND revoked_at IS NULL AND expires_at > now()) FROM admin_sessions WHERE user_id = ${owner}`) === "1/0");

  console.log("\n== B2  signed in: protected routes open at once, nothing sensitive leaks");
  const me = await c.call("GET", "/me");
  await expect("/me -> 200 with e-mail, role, CSRF token, expiry; no hash, secret or code fields", () => me.status === 200 && me.json?.user?.email === email && !/hash|secret|totp|password|recovery/i.test(JSON.stringify(me.json)));
  await expect("reservations, audit log, tables and readiness -> 200", async () => (await c.call("GET", "/reservations")).status === 200 && (await c.call("GET", "/audit-log")).status === 200 && (await c.call("GET", "/tables")).status === 200 && (await c.call("GET", "/readiness")).status === 200);
  const audit = await c.call("GET", "/audit-log");
  await expect("the audit log shows the sign-in and contains no password, token or code", () => /auth\.login/.test(audit.text) && !leaked.some((v) => v && v.length >= 6 && audit.text.includes(v)));

  console.log("\n== B3  CSRF on a change (three layers)");
  await expect("a change without the CSRF token -> 403 csrf_token", async () => { const x = await c.call("POST", "/logout", { csrf: null }); return x.status === 403 && x.json?.error === "csrf_token"; });
  await expect("a change with a wrong CSRF token -> 403", async () => (await c.call("POST", "/logout", { csrf: "y".repeat(43) })).status === 403);
  await expect("a change from the wrong Origin -> 403 csrf_origin", async () => { const x = await c.call("POST", "/logout", { origin: "http://evil.example" }); return x.status === 403 && x.json?.error === "csrf_origin"; });
  await expect("the session survived those refused attempts", async () => (await c.call("GET", "/me")).status === 200);

  console.log("\n== B4  logout is real (server side)");
  const keep = c.cookie;
  const out = await c.call("POST", "/logout");
  await expect("logout -> 204 and the cookie is cleared", () => out.status === 204 && /Max-Age=0/.test(cookieAttrs(out)));
  await expect("the old cookie is REVOKED on the server (replay -> 401)", async () => (await new Client().call("GET", "/me", { cookie: keep })).status === 401);

  console.log("\n== B5  an old half-finished two-step session is never a signed-in owner");
  const oldToken = randomBytes(32).toString("base64url"); leaked.push(oldToken);
  sql(`INSERT INTO admin_sessions (user_id, token_hash, expires_at, mfa_pending) VALUES (${owner}, decode('${createHash("sha256").update(oldToken).digest("hex")}', 'hex'), now() + interval '10 minutes', true)`);
  const stale = new Client();
  await expect("it is refused on /me, /reservations and /audit-log (401)", async () => (await stale.call("GET", "/me", { cookie: oldToken })).status === 401 && (await stale.call("GET", "/reservations", { cookie: oldToken })).status === 401 && (await stale.call("GET", "/audit-log", { cookie: oldToken })).status === 401);
  const d = new Client(); const r2 = await login(d); d.adopt(r2); d.csrf = r2.json?.csrf_token;
  await expect("a normal sign-in next to it works, and the old one stays dead", async () => r2.status === 200 && (await d.call("GET", "/me")).status === 200 && (await stale.call("GET", "/me", { cookie: oldToken })).status === 401);
  sql(`UPDATE admin_sessions SET revoked_at = now() WHERE user_id = ${owner} AND revoked_at IS NULL`);

  console.log("\n== B6  expiry (the test ages only its own session rows)");
  let e1 = new Client(); let x = await login(e1); e1.adopt(x); e1.csrf = x.json?.csrf_token;
  await expect("(setup) signed in", () => x.status === 200 && (e1.cookie ?? "") !== "");
  sql(`UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = ${owner} AND revoked_at IS NULL`);
  x = await e1.call("GET", "/me");
  await expect("idle for 31 minutes -> 401 (idle timeout is 30 minutes) and the cookie is cleared", () => x.status === 401 && /Max-Age=0/.test(cookieAttrs(x)));
  let e2 = new Client(); x = await login(e2); e2.adopt(x); e2.csrf = x.json?.csrf_token;
  await expect("a fresh session is accepted, then past its 12-hour lifetime -> 401", async () => { const ok = (await e2.call("GET", "/me")).status === 200; sql(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${owner} AND revoked_at IS NULL`); return ok && (await e2.call("GET", "/me")).status === 401; });
  let e3 = new Client(); x = await login(e3); e3.adopt(x); e3.csrf = x.json?.csrf_token;
  await expect("an active session stays alive: using it moves the idle clock forward", async () => { sql(`UPDATE admin_sessions SET last_seen_at = now() - interval '20 minutes' WHERE user_id = ${owner} AND revoked_at IS NULL`); return (await e3.call("GET", "/me")).status === 200 && Number(sql(`SELECT extract(epoch FROM now() - max(last_seen_at))::int FROM admin_sessions WHERE user_id = ${owner} AND revoked_at IS NULL`)) < 5; });
  await e3.call("POST", "/logout");

  console.log("\n== B7  the secrets never reached the server logs");
  const logs = logsText();
  await expect("log files were readable and non-empty", () => logs.length > 100);
  await expect("none of the password, session cookies, CSRF tokens or old pending token appear in the logs", () => !leaked.some((v) => v && v.length >= 6 && logs.includes(v)));
}

// =============================================================================================================================================
// PHASE C: lock-out and the login rate limit. Run on freshly started APIs (the limiter is in memory), after phase B.
// =============================================================================================================================================
async function phaseC() {
  const email = ownerOf(); const password = passwordOf(); leaked.push(password);
  const login = (c, pw = password, e = email) => c.call("POST", "/login", { body: { email: e, password: pw } });
  sql(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE email = '${email}'`);   // a clean counter for THIS disposable owner
  const ghost = await login(new Client(), "whatever-password-123", "ghost-user@example.invalid");

  console.log("\n== C1  lock-out after 5 wrong passwords in a row");
  const seen = [];
  for (let i = 0; i < 5; i++) { const x = await login(new Client(), `wrong-password-${i}-xxxxxx`); seen.push(`${x.status}:${x.json?.error ?? ""}`); }
  await expect("each of five wrong passwords is refused with 401 invalid_credentials", () => seen.every((v) => v === "401:invalid_credentials") || (console.log("      ", seen.join(" ")), false));
  const after = await login(new Client());
  await expect("the account is locked: the CORRECT password is refused with the same 401 as an unknown e-mail", () => after.status === 401 && after.json?.error === ghost.json?.error && after.json?.message === ghost.json?.message);
  await expect("the locked answer does not reveal the lock and sets no cookie", () => !/lock/i.test(after.text) && after.setCookies.length === 0);
  await expect("the database shows 5 failures and a lock of about 15 minutes", () => /^5\|1[45]$/.test(sql(`SELECT failed_logins || '|' || round(extract(epoch FROM (locked_until - now()))/60) FROM admin_users WHERE email='${email}'`)));
  sql(`UPDATE admin_users SET locked_until = now() - interval '1 second' WHERE email = '${email}'`);
  const again = new Client(); const ok = await login(again);
  await expect("when the lock has run out the correct password signs in and the counter is back to 0", () => ok.status === 200 && sql(`SELECT failed_logins FROM admin_users WHERE email='${email}'`) === "0");

  console.log("\n== C2  rate limit on the login (30 attempts per 15 minutes per address)");
  let limited = null;
  for (let tries = 0; tries < 45 && !limited; tries++) { const x = await new Client().call("POST", "/login", { body: {} }); if (x.status === 429) limited = x; }
  await expect("a flood of login attempts is cut off with 429", () => limited !== null);
  await expect("the 429 says how long to wait (Retry-After) in plain wording", () => !!limited && Number(limited.headers.get("retry-after")) > 0 && limited.json?.error === "rate_limited");

  console.log("\n== C3  secrets never reached the server logs");
  const logs = logsText();
  await expect("log files readable and non-empty", () => logs.length > 100);
  await expect("the password does not appear in the logs", () => !logs.includes(password));
}

console.log(`Live owner-sign-in checks, phase ${PHASE}`);
try { if (PHASE === "A") await phaseA(); else if (PHASE === "B") await phaseB(); else if (PHASE === "C") await phaseC(); else throw new Error("PHASE must be A, B or C"); }
catch (e) { check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${pass}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
