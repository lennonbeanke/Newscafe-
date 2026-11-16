// Browser run of the owner DASHBOARD OVERVIEW in the installed Microsoft Edge (headless, throw-away profile, DevTools on 127.0.0.1, no external requests).
// The owner API's answers are REPLACED by committed fake data of exactly the shape the API returns (fixtures taken once from the development database
// with read-only SELECTs, plus a few invented fake bookings for today), so no sign-in is needed and the owner account is not touched.
// What this proves: the screens, the numbers, the privacy rules, the exact requests the page makes, failure handling and session-expiry behaviour.
// What it does NOT prove: that the real API answers match the fixtures (the shapes are copied from real rows and the API's own tests cover the routes).
//   OUT_DIR=<folder> node tests/ui/dashboard.ui.mjs        (needs only the frontend dev server on port 3000 and Edge; no backend, no database)
import { readFileSync } from "node:fs";
import { openBrowser } from "./cdp.mjs";

const SITE = "http://localhost:3000";
const OUT = process.env.OUT_DIR;
const OWNER = "dev-owner@example.invalid";
let failures = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`); };

// ---- fake fixtures: committed in tests/fixtures/admin-api.json (regenerate with `node e2e/gen-ui-fixtures.mjs` while the development database runs) ----
const FIX = JSON.parse(readFileSync(new URL("../fixtures/admin-api.json", import.meta.url), "utf8"));
const realRes = FIX.reservations, readiness = FIX.readiness, tables = FIX.tables, audit = FIX.audit;

const DAY = 86400000, TZ_MS = 2 * 3600000;                       // Africa/Johannesburg is UTC+2 all year
const localDate = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const today = localDate(Date.now());
const atLocal = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000 - TZ_MS).toISOString(); };
// re-time the real fake rows so they fall on today+1 .. today+7 (the data was seeded for 13-19 Nov)
const shift = Math.round((Date.parse(`${addDays(today, 1)}T00:00:00Z`) - Date.parse("2026-11-13T00:00:00Z")) / DAY);
const rows = realRes.map((r) => ({ ...r, starts_at: new Date(Date.parse(r.starts_at) + shift * DAY).toISOString(), ends_at: new Date(Date.parse(r.ends_at) + shift * DAY).toISOString() }));
let k = 0;
const fake = (o) => ({ ...rows[0], id: `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, reference: `FAKE${String(k).padStart(4, "0")}`, is_test: false, source: "web", tables: [], guest_email: "fake.guest@example.invalid", guest_phone: "+27 00 000 0000", notes: "Fake booking for the dashboard test", ...o });
rows.push(
  fake({ guest_name: "Alice Anderson", status: "confirmed", party_size: 2, starts_at: atLocal(today, "00:05"), tables: ["T01"] }),     // very early: stays "today" in local time
  fake({ guest_name: "Brian Botha", status: "completed", party_size: 4, starts_at: atLocal(today, "09:00"), tables: ["T05"], source: "phone" }),
  fake({ guest_name: "Carla Cele", status: "confirmed", party_size: 3, starts_at: atLocal(today, "23:30"), tables: ["T08", "T09"] }),
  fake({ guest_name: "Dan Dlamini", status: "pending", party_size: 6, starts_at: atLocal(today, "23:45"), source: "web" }),
  fake({ guest_name: "Eve Ek", status: "cancelled", party_size: 8, starts_at: atLocal(today, "22:00") }),
  fake({ guest_name: "Faith Fourie", status: "no_show", party_size: 5, starts_at: atLocal(today, "21:00") }),
  fake({ guest_name: "Test Person", status: "confirmed", party_size: 2, starts_at: atLocal(today, "20:15"), is_test: true, tables: ["T20"] }),
  fake({ guest_name: "Grace Gumede", status: "pending", party_size: 2, starts_at: atLocal(addDays(today, 2), "19:00") }),
  fake({ guest_name: "Henk Hlongwane", status: "pending", party_size: 4, starts_at: atLocal(addDays(today, 4), "12:30"), source: "walk_in" }),
  fake({ guest_name: "Test Pending", status: "pending", party_size: 2, starts_at: atLocal(addDays(today, 3), "18:00"), is_test: true }),
  fake({ guest_name: "Yesterday Y", status: "confirmed", party_size: 2, starts_at: atLocal(addDays(today, -1), "19:00") }),   // before the window: must never appear
);
const LIVE = new Set(["pending", "confirmed", "completed"]);
const expected = (includeTest) => {
  const inScope = rows.filter((r) => includeTest || !r.is_test);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const per = days.map((d) => { const m = inScope.filter((r) => localDate(Date.parse(r.starts_at)) === d && LIVE.has(r.status)); return { d, b: m.length, g: m.reduce((n, r) => n + r.party_size, 0) }; });
  const pend = inScope.filter((r) => r.status === "pending" && localDate(Date.parse(r.starts_at)) >= today);
  return { today: per[0], week: { b: per.reduce((n, x) => n + x.b, 0), g: per.reduce((n, x) => n + x.g, 0) }, pending: pend.length, hidden: new Set(rows.filter((r) => r.is_test && ((localDate(Date.parse(r.starts_at)) >= today && localDate(Date.parse(r.starts_at)) <= addDays(today, 6)) || (r.status === "pending" && localDate(Date.parse(r.starts_at)) >= today))).map((r) => r.id)).size };
};

// ---- the mock owner API ------------------------------------------------------------------------------------------------------------------------
const requests = [];
const mode = { me: "ok", reservations: "ok", tables: "ok", malformed: false, audit: "ok" };
const err = (status, error, message) => ({ status, json: { error, message, request_id: "mock-request-id-123" } });
function mock({ method, url, body }) {
  requests.push({ method, path: url.pathname.replace("/api/admin", ""), query: Object.fromEntries(url.searchParams), body });
  const p = url.pathname.replace("/api/admin", "");
  if (method !== "GET") return err(405, "method_not_allowed", "Method not allowed.");
  if (p === "/me") return mode.me === "ok" ? { status: 200, json: { user: { email: OWNER, role: "owner" }, csrf_token: "mock-csrf", session_expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), idle_timeout_seconds: 1800 } } : err(401, "unauthenticated", "Please sign in.");
  if (p === "/reservations") {
    if (mode.reservations === "401") return err(401, "unauthenticated", "Please sign in.");
    const q = url.searchParams; const limit = Number(q.get("limit") ?? 50);
    let list = rows.filter((r) => (q.get("include_test") === "true" || !r.is_test) && (!q.get("status") || r.status === q.get("status")) && (!q.get("from") || localDate(Date.parse(r.starts_at)) >= q.get("from")) && (!q.get("to") || localDate(Date.parse(r.starts_at)) <= q.get("to")));
    list = list.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const items = list.slice(0, limit); if (mode.malformed) items.push({ nonsense: true });
    return { status: 200, json: { items, has_more: list.length > limit } };
  }
  if (p === "/readiness") return { status: 200, json: { item: readiness } };
  if (p === "/tables") return mode.tables === "503" ? err(503, "service_unavailable", "The service is temporarily unavailable. Please try again.") : { status: 200, json: { items: tables } };
  if (p === "/audit-log") return mode.audit === "503" ? err(503, "service_unavailable", "x") : { status: 200, json: { items: audit } };
  return err(404, "not_found", "Not found.");
}

const b = await openBrowser({ port: 9334, outDir: OUT, site: SITE, mock });
try {
  console.log(`Browser: ${b.version} (headless, throw-away profile, DevTools on 127.0.0.1:9334). Owner API answers are fake fixtures.`);
  console.log(`Fixtures: ${rows.length} fake reservations (${rows.filter((r) => r.is_test).length} marked test), ${tables.length} tables, ${audit.length} audit rows, today = ${today}`);
  const num = (id) => b.evaluate(`document.querySelector('[data-testid=${id}]')?.textContent?.trim() ?? null`);
  const cardText = (id) => b.evaluate(`document.querySelector('[data-testid=card-${id}]')?.innerText ?? ''`);

  console.log("\n== D1  the overview loads for a signed-in owner and asks the owner API only");
  await b.go("/admin");
  check("the Overview heading and the owner's e-mail are shown", await b.waitFor(`document.querySelector('h1')?.textContent === 'Overview' && document.querySelector('[data-testid=signed-in-email]')?.textContent === ${JSON.stringify(OWNER)}`));
  check("all cards finished loading", await b.waitFor("!document.body.innerText.includes('Loading…') && !!document.querySelector('[data-testid=card-activity]')"));
  const first = requests.slice();
  const key = (r) => `${r.method} ${r.path}`;
  // React StrictMode (development only) mounts everything twice, so the first set of requests is made, aborted and repeated; a production build makes each once.
  const kinds = new Set(first.map(key));
  check("the page asks for me, both reservation lists, readiness, tables and the audit log, each once (or twice in development: StrictMode)", kinds.size === 5 && ["GET /me", "GET /reservations", "GET /readiness", "GET /tables", "GET /audit-log"].every((x) => kinds.has(x)) && [1, 2].includes(first.filter((r) => r.path === "/readiness").length) && first.filter((r) => r.path === "/reservations").length === 2 * first.filter((r) => r.path === "/readiness").length, first.map(key).join(", "));
  check("every request is a read-only GET to the owner API (no writes, no public API)", first.every((r) => r.method === "GET"));
  const wk = first.find((r) => r.path === "/reservations" && !r.query.status)?.query, pd = first.find((r) => r.path === "/reservations" && r.query.status)?.query;
  check("week query: today to today+6, include_test, limit 100", wk?.from === today && wk?.to === addDays(today, 6) && wk?.include_test === "true" && wk?.limit === "100", JSON.stringify(wk));
  check("pending query: status=pending from today, limit 100", pd?.status === "pending" && pd?.from === today && pd?.limit === "100", JSON.stringify(pd));
  check("audit query asks for the latest 50 events", first.find((r) => r.path === "/audit-log")?.query.limit === "50");
  check("the page shows today's date in the cafe's time zone", (await num("today-date"))?.length > 4);

  console.log("\n== D2  numbers (test bookings hidden by default)");
  const e1 = expected(false);
  check("a banner says how many test bookings are hidden", (await b.text()).includes(`${e1.hidden} test bookings are hidden`) || (await b.text()).includes(`${e1.hidden} test booking is hidden`), String(e1.hidden));
  check(`Today: ${e1.today.b} bookings, ${e1.today.g} guests`, (await num("today-bookings")) === String(e1.today.b) && (await num("today-guests")) === String(e1.today.g), `${await num("today-bookings")}/${await num("today-guests")}`);
  check(`Next 7 days: ${e1.week.b} bookings, ${e1.week.g} guests (cancelled, no-show and yesterday excluded)`, (await num("week-bookings")) === String(e1.week.b) && (await num("week-guests")) === String(e1.week.g), `${await num("week-bookings")}/${await num("week-guests")}`);
  check(`Needs attention: ${e1.pending} pending`, (await num("pending-count")) === String(e1.pending), await num("pending-count"));
  await b.shot("overview-default");

  console.log("\n== D3  showing test bookings changes the numbers on screen without asking the server again");
  const before = requests.length;
  await b.evaluate("document.querySelector('input[type=checkbox]').click()");
  const e2 = expected(true);
  check(`Today becomes ${e2.today.b} bookings / ${e2.today.g} guests`, await b.waitFor(`document.querySelector('[data-testid=today-bookings]')?.textContent === '${e2.today.b}' && document.querySelector('[data-testid=today-guests]')?.textContent === '${e2.today.g}'`));
  check(`Next 7 days becomes ${e2.week.b} / ${e2.week.g}; pending ${e2.pending}`, (await num("week-bookings")) === String(e2.week.b) && (await num("week-guests")) === String(e2.week.g) && (await num("pending-count")) === String(e2.pending));
  check("the 'hidden' banner is gone", !(await b.text()).includes("test bookings are hidden") && !(await b.text()).includes("test booking is hidden"));
  check("no new request was made for the filter change", requests.length === before);
  await b.shot("overview-with-test-bookings");

  console.log("\n== D4  card contents");
  const list = await b.evaluate("[...document.querySelectorAll('[data-testid=card-today-list] li')].map((li) => li.innerText.replace(/\\s+/g,' ').trim())");
  const todayRows = rows.filter((r) => localDate(Date.parse(r.starts_at)) === today && r.status !== "cancelled" && r.status !== "no_show").sort((a, c) => Date.parse(a.starts_at) - Date.parse(c.starts_at));
  check(`today's list has ${todayRows.length} bookings (cancelled and no-show left out), in time order`, list.length === todayRows.length && list.every((t, i) => t.startsWith(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(todayRows[i].starts_at)))), JSON.stringify(list));
  check("each line shows time, short name, party, table(s), source and status; test bookings are tagged", /Alice A\./i.test(list.join()) && /Carla C\..*T08, T09/i.test(list.join()) && /Phone/i.test(list.join()) && /Completed/i.test(list.join()) && /Test P\. TEST/i.test(list.join()), list.join(" | "));
  const att = await cardText("attention");
  check("pending card lists the soonest pending bookings by short name", /Dan D\./.test(att) && /Grace G\./.test(att) && /Henk H\./.test(att), att.replace(/\s+/g, " "));
  const ready = await num("readiness-status");
  check("readiness says ready, with the checklist and who confirms bookings", ready === "Ready for online booking requests" && /Bookings are confirmed by you/.test(await cardText("readiness")) && (await cardText("readiness")).includes("Opening hours set"), ready);
  const tc = await cardText("tables");
  check(`tables card: ${tables.filter((t) => t.is_active).length} active, ${tables.filter((t) => t.online_bookable).length} online-bookable, sections listed`, (await num("tables-active")) === String(tables.filter((t) => t.is_active).length) && /Bar \d+/.test(tc) && /Window \d+/.test(tc), tc.replace(/\s+/g, " "));
  const act = await b.evaluate("[...document.querySelectorAll('[data-testid=card-activity] li')].map((li) => li.innerText.replace(/\\s+/g,' ').trim())");
  check("recent activity shows at most 8 plain-language events (no raw action codes)", act.length > 0 && act.length <= 8 && act.every((t) => !/\bauth\.|\breservation\.|_/.test(t)), act.join(" | "));
  check("sign-in security card summarises failed sign-ins", /failed sign-in|No failed sign-ins/.test(await num("security-status") ?? ""), await num("security-status"));
  await b.shot("overview-cards");

  console.log("\n== D5  privacy: no guest contact details or notes on the screen");
  const all = await b.text(); const html = await b.evaluate("document.documentElement.outerHTML");
  check("no guest e-mail, phone number or notes anywhere in the visible text or the page HTML", !/fake\.guest@|test\.guest\.\d+@|\+27 00 000|Fake development booking|Fake booking for the dashboard test/.test(all + html));
  check("full guest names are not shown (short names only)", !/Alice Anderson|Brian Botha|Carla Cele|Dan Dlamini|Test Guest 0\d\d/.test(all));
  check("only the owner's own e-mail appears", [...(all.match(/[\w.+-]+@[\w.-]+/g) ?? [])].every((m) => m === OWNER), JSON.stringify([...new Set(all.match(/[\w.+-]+@[\w.-]+/g) ?? [])]));

  console.log("\n== D6  no automatic refresh; the Refresh button asks again");
  const n0 = requests.length; await b.sleep(7000);
  check("nothing is requested while the page sits idle (no polling; the idle timeout still works)", requests.length === n0);
  await b.clickButton("Refresh");
  check("Refresh makes exactly the 6 requests again (me is not repeated)", await b.waitFor(`document.querySelector('[data-testid=updated]')?.textContent.includes('Updated')`) && (await b.sleep(800), requests.length - n0 === 5), String(requests.length - n0));

  console.log("\n== D7  one card failing does not blank the others");
  mode.tables = "503"; await b.clickButton("Refresh");
  check("Tables card shows a plain error with a reference; other cards still show their data", await b.waitFor("(document.querySelector('[data-testid=card-tables]')?.innerText ?? '').includes('could not be loaded')") && (await num("today-bookings")) !== null && !!(await cardText("activity")).trim());
  check("the error wording is plain (temporarily unavailable) and shows the request reference", /temporarily unavailable/.test(await cardText("tables")) && /Reference: mock-request-id-123/.test(await cardText("tables")));
  await b.shot("one-card-failed");
  mode.tables = "ok";

  console.log("\n== D8  rows the page cannot read are reported, not guessed");
  mode.malformed = true; await b.clickButton("Refresh");
  check("a warning counts the unreadable items", await b.waitFor("document.body.innerText.includes('could not be read and')"));
  mode.malformed = false; await b.clickButton("Refresh"); await b.waitFor("!document.body.innerText.includes('could not be read and')");

  console.log("\n== D9  an expired session sends the owner to sign in");
  mode.reservations = "401"; mode.me = "401"; await b.clickButton("Refresh");
  check("a 401 on any card ends the session on screen: redirected to sign-in with 'Your session ended'", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('Your session ended. Please sign in again.')"), await b.url());
  check("no owner data is left on the sign-in screen", !/Alice A\.|Carla C\.|Today's bookings|Recent activity/.test(await b.text()));
  await b.shot("session-expired");
  mode.reservations = "ok"; mode.me = "ok";

  console.log("\n== D10  signed out: the dashboard is not reachable");
  mode.me = "401"; await b.go("/admin");
  check("opening /admin without a session lands on the sign-in screen and shows no cards", await b.waitFor("location.pathname === '/admin/login'") && !(await b.text()).includes("Today's bookings"));
  mode.me = "ok";

  console.log("\n== D11  look and feel");
  await b.go("/admin"); await b.waitFor("!document.body.innerText.includes('Loading…')");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.sleep(600);
  check("phone width (390 px): no sideways scrolling", await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
  await b.shot("phone-width");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("document.documentElement.setAttribute('data-theme','light')"); await b.sleep(400); await b.shot("light-theme");
  await b.evaluate("document.documentElement.setAttribute('data-theme','dark')");
  const a11y = await b.evaluate(`(() => { const secs = [...document.querySelectorAll('section[aria-labelledby]')]; return secs.length >= 8 && secs.every((s) => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.length > 0) && document.querySelectorAll('h1').length === 1 && [...document.querySelectorAll('button')].every((x) => (x.getAttribute('aria-label') || x.textContent).trim().length > 0) && !!document.querySelector('nav[aria-label]') && !!document.querySelector('main#main'); })()`);
  check("accessibility basics: one h1, 8 cards each labelled by a heading, named buttons, a labelled nav, a main landmark", a11y === true);
  check("the page has no public navbar, footer or custom cursor", (await b.evaluate("document.querySelectorAll('footer').length")) === 0 && !(await b.text()).includes("Skip to content"));

  console.log("\n== D12  hygiene");
  const own = b.cdp.errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::|401|503|405/.test(e));
  check("no JavaScript exceptions or console errors from the dashboard", own.length === 0, own.slice(0, 3).join(" | "));
  check("every request the page made to the API was to the owner API (/me, /reservations, /readiness, /tables, /audit-log)", requests.every((r) => ["/me", "/reservations", "/readiness", "/tables", "/audit-log"].includes(r.path)), [...new Set(requests.map((r) => r.path))].join(","));
  console.log(`      requests to other hosts that were blocked (nothing left this computer): ${[...b.blockedHosts].join(", ") || "none"}`);
} catch (e) {
  check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
} finally {
  await b.close();
  console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${total - failures}/${total} dashboard UI checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
