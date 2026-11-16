// Browser run of the OWNER LOGIN (e-mail and password only) in the installed Microsoft Edge (headless, throw-away profile, DevTools on 127.0.0.1,
// no external requests). The owner API is replaced by a small fake that follows the real API's contract; no real account or database is touched.
// What this proves: the screen asks for e-mail and password and nothing else, what a wrong password / lock-out / outage looks like, that a correct
// password goes straight to the dashboard (or the page asked for, never another site), CSRF headers on later changes, logout, and that the password
// is never kept. What it does NOT prove: the real API's behaviour (the backend's own tests cover that).
//   OUT_DIR=<folder> node tests/ui/login.ui.mjs     (needs only the frontend dev server on port 3000 and Edge)
import { readFileSync } from "node:fs";
import { openBrowser } from "./cdp.mjs";

const SITE = "http://localhost:3000";
const OUT = process.env.OUT_DIR;
const OWNER = "admin@newscafe.co.za";
const GOOD = "a-long-fake-password-123";                 // fake: exists only in this test
let failures = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`); };
const FIX = JSON.parse(readFileSync(new URL("../fixtures/admin-api.json", import.meta.url), "utf8"));

const requests = [];
const state = { signedIn: false, mode: "ok", meDelayMs: 0 };           // mode: ok | wrong | locked | down
const err = (status, error, message, headers) => ({ status, headers, json: { error, message, request_id: "mock-request-id-789" } });
function mock({ method, url, body, headers }) {
  const p = url.pathname.replace("/api/admin", "");
  requests.push({ method, path: p, body: body ? JSON.parse(body) : null, headers });
  if (p === "/login" && method === "POST") {
    const b = JSON.parse(body ?? "{}");
    if (headers["X-Requested-With"] !== "newscafe-admin" || headers["Origin"] !== SITE) return err(403, "csrf_origin", "Request not allowed from this origin.");
    if (state.mode === "down") return err(503, "service_unavailable", "The service is temporarily unavailable. Please try again.");
    if (state.mode === "locked") return err(429, "rate_limited", "Too many attempts. Please wait and try again.", { "Retry-After": "900" });
    if (b.email === OWNER && b.password === GOOD && state.mode === "ok") {
      state.signedIn = true;
      return { status: 200, json: { signed_in: true, csrf_token: "mock-csrf-from-login", user: { email: OWNER, role: "owner" }, session_expires_at: new Date(Date.now() + 12 * 3600000).toISOString() } };
    }
    return err(401, "invalid_credentials", "The e-mail address or password is not correct.");
  }
  if (p === "/me") return state.signedIn ? { status: 200, json: { user: { email: OWNER, role: "owner" }, csrf_token: "mock-csrf-from-login", session_expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), idle_timeout_seconds: 1800 } } : { ...err(401, "unauthenticated", "Please sign in."), delayMs: state.meDelayMs };
  if (p === "/logout" && method === "POST") {
    if (headers["X-CSRF-Token"] !== "mock-csrf-from-login") return err(403, "csrf_token", "Missing or invalid CSRF token.");
    state.signedIn = false; return { status: 204, json: null };
  }
  if (!state.signedIn) return err(401, "unauthenticated", "Please sign in.");
  if (p === "/reservations") return { status: 200, json: { items: [], has_more: false } };
  if (p === "/readiness") return { status: 200, json: { item: FIX.readiness } };
  if (p === "/tables") return { status: 200, json: { items: FIX.tables } };
  if (p === "/audit-log") return { status: 200, json: { items: [] } };
  return err(404, "not_found", "Not found.");
}

const b = await openBrowser({ port: 9337, outDir: OUT, site: SITE, mock });
const posts = () => requests.filter((x) => x.method === "POST" && x.path === "/login");
const text = () => b.text();
const has = async (s) => (await text()).includes(s);
const waitText = (s, t = 15000) => b.waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, t);
async function fill(email, password) { await b.setField("input[name=email]", email); await b.setField("input[name=password]", password); }

try {
  console.log(`Browser: ${b.version} (headless, throw-away profile, DevTools on 127.0.0.1:9337). The owner API is a FAKE.`);

  console.log("\n== L1  the login screen asks for e-mail and password, nothing else");
  await b.go("/admin");
  check("opening /admin while signed out lands on the login screen", await b.waitFor("location.pathname === '/admin/login' && !!document.querySelector('input[name=email]')"));
  check("the heading says 'Owner login' and the button says 'Sign in'", (await b.evaluate("document.querySelector('h1').textContent")) === "Owner login" && (await b.evaluate("document.querySelector('form button[type=submit]').textContent")) === "Sign in");
  check("exactly two fields: e-mail and password (no code, no key, no extra step)", (await b.evaluate("[...document.querySelectorAll('form input, form select, form textarea')].map((i) => i.name).join()")) === "email,password");
  const page = await text();
  check("no word about an authenticator, a code, a recovery code or a second step anywhere on the screen", !/authenticator|recovery|second (code|step|factor)|two-factor|6-digit|setup key|set up/i.test(page), page.slice(0, 200));
  check("the password field is masked and offers the password manager hint", await b.evaluate("document.querySelector('input[name=password]').type === 'password' && document.querySelector('input[name=password]').autocomplete === 'current-password'"));
  check("the e-mail field is focused on arrival", await b.evaluate("document.activeElement?.getAttribute('name') === 'email'"));
  await b.shot("login-screen");

  console.log("\n== L2  mistakes");
  await b.clickButton("Sign in"); await b.sleep(400);
  check("submitting empty shows plain messages and sends nothing", (await has("Enter a valid e-mail address.")) && (await has("Enter your password.")) && posts().length === 0);
  await fill("not-an-email", "x"); await b.clickButton("Sign in"); await b.sleep(300);
  check("a malformed e-mail is explained on the page, nothing sent", (await has("Enter a valid e-mail address.")) && posts().length === 0);
  state.mode = "wrong";
  await fill(OWNER, "the-wrong-password"); await b.clickButton("Sign in");
  check("a wrong password shows the one generic message with a reference", await waitText("The e-mail address or password is not correct.") && (await has("Reference: mock-request-id-789")));
  check("the error is announced to screen readers and the password field was cleared", (await b.evaluate("!!document.querySelector('[role=alert]')")) && (await b.evaluate("document.querySelector('input[name=password]').value === ''")));
  check("no 'Enter your password' nag appears under the error", !(await has("Enter your password.")));
  check("the wrong password was sent exactly once, to the login endpoint only", posts().length === 1 && posts()[0].body.password === "the-wrong-password");
  await b.shot("wrong-password");
  state.mode = "locked";
  await fill(OWNER, GOOD); await b.clickButton("Sign in");
  check("too many attempts: a plain message with the wait (15 minutes), still no sign-in", await waitText("Too many attempts. Please wait about 15 minutes and try again.") && (await b.url()) === "/admin/login");
  state.mode = "down";
  await fill(OWNER, GOOD); await b.clickButton("Sign in");
  check("a service outage says so plainly and does not blame the password", await waitText("The service is temporarily unavailable. Please try again in a moment.") && !(await has("not correct")));
  await b.shot("service-down");

  console.log("\n== L3  a correct password goes straight to the dashboard");
  state.mode = "ok";
  const before = posts().length;
  await fill(OWNER, GOOD); await b.clickButton("Sign in");
  check("one request, then the owner dashboard: no second screen", await b.waitFor("location.pathname === '/admin' && document.querySelector('h1')?.textContent === 'Overview'") && posts().length === before + 1);
  check("the login request had the CSRF header and the dashboard Origin, and carried exactly e-mail and password", (() => { const r = posts().at(-1); return r.headers["X-Requested-With"] === "newscafe-admin" && r.headers["Origin"] === SITE && Object.keys(r.body).sort().join() === "email,password" && r.body.email === OWNER; })());
  check("the owner's e-mail is shown in the header", (await b.evaluate("document.querySelector('[data-testid=signed-in-email]')?.textContent")) === OWNER);
  await b.shot("dashboard-after-login");
  check("the password is not on the page, in the address, or in any storage", !(JSON.stringify(await b.evaluate("({ html: document.documentElement.outerHTML, url: location.href, ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage), cookie: document.cookie })")).includes(GOOD)));
  check("no session cookie is readable by page script (the real one is HttpOnly and set by the server)", !/nc_admin_session/.test(await b.evaluate("document.cookie")));
  check("nothing is kept in sessionStorage or IndexedDB, and localStorage only holds the site's theme choice", (await b.evaluate("JSON.stringify([Object.keys(sessionStorage), Object.keys(localStorage).filter((k) => k !== 'nc-theme')])")) === "[[],[]]" && (await b.evaluate("indexedDB.databases().then((d) => d.length)")) === 0);

  console.log("\n== L3b  the form is shown only after the page has asked whether you are already signed in");
  await b.clickButton("Logout"); await b.waitFor("location.pathname === '/admin/login'");
  state.meDelayMs = 1800;
  await b.go("/admin/login");
  check("while that first check is still on its way, no form is shown (a spinner says so), so nothing can be typed early", !(await b.evaluate("!!document.querySelector('input[name=email]')")) && (await has("Checking your session")));
  check("the form appears once the check has answered 'not signed in'", await b.waitFor("!!document.querySelector('input[name=email]')"));
  await fill(OWNER, GOOD); await b.clickButton("Sign in");
  check("and signing in then works as usual", await b.waitFor("location.pathname === '/admin' && document.querySelector('h1')?.textContent === 'Overview'"));
  state.meDelayMs = 0;

  console.log("\n== L4  already signed in, redirects and logout");
  await b.go("/admin/login");
  check("opening the login screen while signed in goes straight to the dashboard", await b.waitFor("location.pathname === '/admin'"));
  await b.go("/admin/login?next=/admin/reservations");
  check("a ?next= link inside the admin area is honoured", await b.waitFor("location.pathname === '/admin/reservations'"));
  await b.clickButton("Logout");
  check("Logout returns to the login screen with 'You have been signed out'", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('You have been signed out')"));
  check("the logout request carried the CSRF token that sign-in handed out", requests.some((x) => x.path === "/logout" && x.headers["X-CSRF-Token"] === "mock-csrf-from-login"));
  await b.shot("signed-out");
  await b.go("/admin/login?next=/admin/reservations"); await b.waitFor("!!document.querySelector('input[name=email]')");
  await fill(OWNER, GOOD); await b.clickButton("Sign in");
  check("after login, the page that was asked for opens (/admin/reservations)", await b.waitFor("location.pathname === '/admin/reservations'"));
  await b.clickButton("Logout"); await b.waitFor("location.pathname === '/admin/login'");
  for (const evil of ["//evil.example", "https://evil.example", "/menu", "/admin/../menu", "/\\evil.example"]) {
    await b.go(`/admin/login?next=${encodeURIComponent(evil)}`); await b.waitFor("!!document.querySelector('input[name=email]')");
    await fill(OWNER, GOOD); await b.clickButton("Sign in");
    const landed = await b.waitFor("location.pathname === '/admin' && location.hostname === 'localhost'");
    check(`a crafted ?next=${evil} never leaves the admin area (lands on /admin)`, landed && (await b.evaluate("location.origin")) === SITE, await b.url());
    await b.clickButton("Logout"); await b.waitFor("location.pathname === '/admin/login'");
  }

  console.log("\n== L5  look and feel and hygiene");
  await b.go("/admin/login"); await b.waitFor("!!document.querySelector('input[name=email]')");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await b.sleep(500);
  check("phone width (390 px): no sideways scrolling", await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
  await b.shot("phone-width");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("document.documentElement.setAttribute('data-theme','light')"); await b.sleep(300); await b.shot("light-theme"); await b.evaluate("document.documentElement.setAttribute('data-theme','dark')");
  check("accessibility basics: every field labelled, one h1, a named button, a main landmark", await b.evaluate("[...document.querySelectorAll('input')].every((i) => i.labels && i.labels.length > 0) && document.querySelectorAll('h1').length === 1 && document.querySelector('form button[type=submit]').textContent.trim().length > 0 && !!document.querySelector('main#main')"));
  const own = b.cdp.errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::|401|403|404|429|503/.test(e));
  check("no JavaScript exceptions or console errors", own.length === 0, own.slice(0, 3).join(" | "));
  console.log(`      requests to other hosts that were blocked (nothing left this computer): ${[...b.blockedHosts].join(", ") || "none"}`);
} catch (e) {
  check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
} finally {
  await b.close();
  console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${total - failures}/${total} login UI checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
