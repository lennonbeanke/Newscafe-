// LIVE browser run of the OWNER LOGIN and dashboard against the REAL local servers (frontend :3000, owner API :8788 through the site's proxy, dev database),
// in the installed Microsoft Edge (headless, throw-away profile, DevTools on 127.0.0.1 only, every request to a non-local host blocked).
// Sign-in is e-mail and password only. It signs in as a DISPOSABLE owner (an @example.invalid address with a throw-away password) and only READS
// bookings: it never confirms, cancels, edits or moves anything. Never use a real owner account here.
//   OWNER_EMAIL=disposable@example.invalid OWNER_PASSWORD_FILE=<file> OUT_DIR=<folder for screenshots> node e2e/live-ui.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { openBrowser } from "../frontend/tests/ui/cdp.mjs";

const SITE = "http://localhost:3000";
const email = process.env.OWNER_EMAIL ?? "";
const password = readFileSync(process.env.OWNER_PASSWORD_FILE, "utf8").split(/\r?\n/)[0];
const OUT = process.env.OUT_DIR;
assert.ok(/@example\.invalid$/.test(email) && OUT, "OWNER_EMAIL must be a DISPOSABLE @example.invalid owner, and OUT_DIR is required");
let failures = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`); };
const dbUser = /^POSTGRES_USER=(.*)$/m.exec(readFileSync(new URL("../backend/database/.env", import.meta.url), "utf8"))?.[1];
const sql = (q) => execFileSync("docker", ["exec", "newscafe-db-dev", "psql", "-X", "-q", "-U", dbUser, "-d", "newscafe_dev", "-tAc", q], { encoding: "utf8" }).trim();
const me = `(SELECT id FROM admin_users WHERE email='${email}')`;

const b = await openBrowser({ port: 9338, outDir: OUT, site: SITE });
const text = () => b.text();
const has = async (s) => (await text()).includes(s);
const waitText = (s, t = 20000) => b.waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, t);
const signIn = async (pw = password) => { await b.go("/admin/login"); await b.waitFor("!!document.querySelector('input[name=email]')"); await b.setField("input[name=email]", email); await b.setField("input[name=password]", pw); await b.clickButton("Sign in"); };

try {
  console.log(`Browser: ${b.version} (headless, throw-away profile, DevTools on 127.0.0.1:9338). REAL servers, disposable owner.`);

  console.log("\n== W1  the login screen");
  await b.go("/admin");
  check("opening /admin while signed out lands on the login screen", await b.waitFor("location.pathname === '/admin/login' && !!document.querySelector('input[name=email]')"));
  check("heading 'Owner login', button 'Sign in', exactly two fields (e-mail, password)", (await b.evaluate("document.querySelector('h1').textContent")) === "Owner login" && (await b.evaluate("document.querySelector('form button[type=submit]').textContent")) === "Sign in" && (await b.evaluate("[...document.querySelectorAll('form input')].map((i) => i.name).join()")) === "email,password");
  check("no mention of an authenticator, a code, a recovery code or a second step", !/authenticator|recovery|second (code|step|factor)|two-factor|6-digit|setup key/i.test(await text()));
  await b.shot("login");

  console.log("\n== W2  a wrong password");
  const failedBefore = Number(sql(`SELECT failed_logins FROM admin_users WHERE email='${email}'`));
  await signIn("definitely-the-wrong-password");
  check("shows the one generic message with a reference, and clears the password field", await waitText("The e-mail address or password is not correct.") && (await b.evaluate("document.querySelector('input[name=password]').value === ''")) && /Reference: [0-9a-f-]{36}/.test(await text()));
  check("the real server counted exactly one failure", Number(sql(`SELECT failed_logins FROM admin_users WHERE email='${email}'`)) === failedBefore + 1);
  await b.shot("wrong-password");

  console.log("\n== W3  the correct password goes straight to the dashboard");
  await signIn();
  check("one step: the Overview opens, with the owner's e-mail in the header", await b.waitFor(`location.pathname === '/admin' && document.querySelector('h1')?.textContent === 'Overview' && document.querySelector('[data-testid=signed-in-email]')?.textContent === ${JSON.stringify(email)}`));
  check("the counter of failed sign-ins is back to 0 and the sign-in is recorded", sql(`SELECT failed_logins || '|' || (last_login_at IS NOT NULL) FROM admin_users WHERE email='${email}'`) === "0|true");
  check("every card finished loading from the REAL owner API (no 'could not be loaded')", await b.waitFor("!document.body.innerText.includes('Loading…') && !!document.querySelector('[data-testid=card-activity]')") && !(await has("could not be loaded")));
  check("the readiness card shows real data from the development database", /Ready for online booking requests|Not ready for online booking yet/.test(await text()));
  await b.shot("dashboard-real-api");
  const cookies = (await b.cdp.send("Network.getAllCookies")).cookies.find((c) => c.name === "nc_admin_session");
  check("the browser holds the session cookie as HttpOnly, SameSite=Strict, Path=/api/admin (not readable by script)", !!cookies && cookies.httpOnly && cookies.sameSite === "Strict" && cookies.path === "/api/admin" && !/nc_admin_session/.test(await b.evaluate("document.cookie")));
  check("the password is not in the page, address or storage", !JSON.stringify(await b.evaluate("({ h: document.documentElement.outerHTML, u: location.href, l: JSON.stringify(localStorage), s: JSON.stringify(sessionStorage) })")).includes(password));

  console.log("\n== W4  reading real bookings (nothing is changed)");
  await b.go("/admin/reservations");
  check("the Reservations list loads from the real API", await b.waitFor("!!document.querySelector('[data-testid=results] ol') || !!document.querySelector('[data-testid=empty]')"));
  await b.evaluate("document.querySelector('input[type=checkbox]').click()");
  await b.setField("input[name=to]", "2099-12-31");
  check("with test bookings included the development bookings appear", await b.waitFor("document.querySelectorAll('[data-testid=results] ol > li').length > 0"));
  await b.shot("reservations-real-api");
  const writesBefore = sql("SELECT count(*) FROM reservation_events");
  await b.evaluate("document.querySelector('[data-testid=results] ol a').click()");
  check("opening a booking shows its details from the real API", await b.waitFor("location.pathname.startsWith('/admin/reservations/') && !!document.querySelector('[data-testid=guest-name]')") && /booking/i.test(await text()) && /what would you like to do?/i.test(await text()));
  await b.shot("booking-real-api");
  check("nothing about any booking was changed (no new booking history rows)", sql("SELECT count(*) FROM reservation_events") === writesBefore);

  console.log("\n== W5  reload, logout, and the dead cookie");
  await b.go("/admin");
  check("reloading keeps the session (read from the HttpOnly cookie)", await waitText(email));
  await b.clickButton("Logout");
  check("Logout returns to the login screen with 'You have been signed out'", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('You have been signed out')"));
  check("the session was revoked on the server and the cookie removed", sql(`SELECT count(*) FROM admin_sessions WHERE user_id = ${me} AND revoked_at IS NULL AND expires_at > now()`) === "0" && !(await b.cdp.send("Network.getAllCookies")).cookies.some((c) => c.name === "nc_admin_session"));
  await b.go("/admin");
  check("after logout /admin redirects to the login screen again", await b.waitFor("location.pathname === '/admin/login'"));

  console.log("\n== W6  idle expiry on the real server");
  await signIn();
  check("(setup) signed in again", await b.waitFor("location.pathname === '/admin' && document.querySelector('h1')?.textContent === 'Overview'"), (await text()).slice(0, 160));
  sql(`UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = ${me} AND revoked_at IS NULL`);
  await b.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  check("after 31 idle minutes the owner is sent to sign in with 'Your session ended'", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('Your session ended. Please sign in again.')"), await b.url());
  await b.shot("session-ended");

  console.log("\n== W7  five wrong passwords lock the account (the same plain message every time)");
  sql(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE email='${email}'`);
  for (let i = 0; i < 5; i++) { await signIn(`wrong-password-${i}-xxxxxx`); await waitText("The e-mail address or password is not correct."); }
  check("after five failures the real server has locked the account for about 15 minutes", /^5\|1[45]$/.test(sql(`SELECT failed_logins || '|' || round(extract(epoch FROM (locked_until - now()))/60) FROM admin_users WHERE email='${email}'`)));
  await signIn();
  check("even the correct password now gets the same generic message (no hint that it is locked)", await waitText("The e-mail address or password is not correct.") && !(await has("lock")) && (await b.url()) === "/admin/login");
  sql(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE email='${email}'`);
  await signIn();
  check("once the lock is gone the correct password signs in again", await b.waitFor("location.pathname === '/admin' && document.querySelector('h1')?.textContent === 'Overview'"));
  await b.clickButton("Logout"); await b.waitFor("location.pathname === '/admin/login'");

  console.log("\n== W8  hygiene");
  const own = b.cdp.errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::|401|403|404|429|503/.test(e));
  check("no JavaScript exceptions or console errors", own.length === 0, own.slice(0, 3).join(" | "));
  console.log(`      requests to other hosts that were blocked (nothing left this computer): ${[...b.blockedHosts].join(", ") || "none"}`);
} catch (e) {
  check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
} finally {
  await b.close();
  console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${total - failures}/${total} live UI checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
