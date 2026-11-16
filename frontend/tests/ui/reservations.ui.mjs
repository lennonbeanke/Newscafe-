// Browser run of the owner RESERVATION MANAGEMENT screens in the installed Microsoft Edge (headless, throw-away profile, DevTools on 127.0.0.1, no external requests).
// The owner API is replaced by a small STATEFUL fake that follows the real API's rules (status changes, edit validation, move conflicts, CSRF headers) and uses
// only fake data. No sign-in is needed and no real owner account or database is touched.
// What this proves: the screens, the exact requests (paths, bodies, CSRF headers), confirmations, validation, failure messages, privacy and session expiry.
// What it does NOT prove: that the real API behaves like the fake (the backend's own 541 tests cover the real API).
//   OUT_DIR=<folder> node tests/ui/reservations.ui.mjs     (needs only the frontend dev server on port 3000 and Edge)
import { readFileSync } from "node:fs";
import { openBrowser } from "./cdp.mjs";

const SITE = "http://localhost:3000";
const OUT = process.env.OUT_DIR;
const OWNER = "dev-owner@example.invalid";
let failures = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`); };

// ---- fake data -------------------------------------------------------------------------------------------------------------------------------------
const FIX = JSON.parse(readFileSync(new URL("../fixtures/admin-api.json", import.meta.url), "utf8"));
const tables = FIX.tables;
const TAKEN_TABLE = tables[3].id;                                       // moving onto this table always conflicts
const DAY = 86400000, TZ_MS = 2 * 3600000;
const localDate = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const today = localDate(Date.now());
const at = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000 - TZ_MS).toISOString(); };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const mk = (o) => { const id = uuid(); const starts = o.starts_at; return { id, reference: `FK${String(n).padStart(6, "0")}`, status: "confirmed", party_size: 2, starts_at: starts, ends_at: new Date(Date.parse(starts) + 90 * 60000).toISOString(), duration_minutes: 90,
  guest_name: `Guest ${n}`, guest_email: `guest${n}@example.invalid`, guest_phone: `+27 00 000 ${String(1000 + n)}`, notes: null, source: "web", is_test: false, consent_at: starts, created_at: starts, updated_at: starts,
  confirmed_at: o.status === "pending" ? null : starts, cancelled_at: null, cancel_reason: null, tables: ["T01"], ...o }; };
const rows = [];
for (let d = 0; d < 14; d++) for (let k = 0; k < 5; k++) rows.push(mk({ starts_at: at(addDays(today, d), `${String(12 + k * 2).padStart(2, "0")}:00`), status: ["confirmed", "confirmed", "cancelled", "completed", "confirmed"][k], guest_name: `Guest ${String(rows.length + 1).padStart(3, "0")}` }));
for (let i = 0; i < 20; i++) rows.push(mk({ starts_at: at(addDays(today, i % 10), "21:00"), is_test: true, guest_name: `Test Guest ${String(i + 1).padStart(2, "0")}`, source: "admin" }));
const PIA = mk({ guest_name: "Pia Pending", status: "pending", party_size: 4, starts_at: at(addDays(today, 1), "11:00"), tables: [], notes: "Window seat please", guest_phone: "+27 00 000 7001", guest_email: "pia@example.invalid" });
const CONRAD = mk({ guest_name: "Conrad Confirmed", status: "confirmed", party_size: 3, starts_at: at(addDays(today, 1), "11:30"), tables: ["T07"], notes: null, guest_phone: "+27 00 000 7002", guest_email: "conrad@example.invalid" });
const NOSHOW = mk({ guest_name: "Nolan Noshow", status: "confirmed", party_size: 2, starts_at: at(addDays(today, 1), "10:30"), tables: ["T06"] });
const PHIL = mk({ guest_name: "Phil Phoneonly", status: "confirmed", starts_at: at(addDays(today, 1), "11:45"), guest_email: null, guest_phone: "+27 00 000 7003", tables: ["T09"] });
const CAROL = mk({ guest_name: "Carol Cancelled", status: "cancelled", starts_at: at(addDays(today, 2), "11:00"), cancelled_at: at(today, "09:00"), cancel_reason: "Guest rang to cancel", tables: [], confirmed_at: at(addDays(today, -1), "10:00") });
const DONE = mk({ guest_name: "Dora Done", status: "completed", starts_at: at(addDays(today, 0), "08:00") });
const RACE = mk({ guest_name: "Rex Race", status: "confirmed", starts_at: at(addDays(today, 3), "11:00") });
const UNK = mk({ guest_name: "Uma Unknown", status: "pending", starts_at: at(addDays(today, 3), "12:00"), tables: [] });
const EXP = mk({ guest_name: "Ed Expired", status: "confirmed", starts_at: at(addDays(today, 3), "13:00") });
const MOVE = mk({ guest_name: "Mo Mover", status: "confirmed", party_size: 2, starts_at: at(addDays(today, 4), "11:00"), tables: ["T11"] });
rows.push(PIA, CONRAD, NOSHOW, PHIL, CAROL, DONE, RACE, UNK, EXP, MOVE);
const byId = new Map(rows.map((r) => [r.id, r]));

// ---- the stateful fake owner API ------------------------------------------------------------------------------------------------------------------
const requests = [];       // every request the page makes
const mode = { me: "ok", unknownOutcomeFor: null, staleStatusFor: null, expireOnWrite: false };
const err = (status, error, message) => ({ status, json: { error, message, request_id: "mock-request-id-456" } });
const MSG = { status_change_not_allowed: "That status change is not allowed.", table_taken: "That table is no longer free.", invalid_input: "Some details are not valid.", not_found: "Not found." };
const nowIso = () => new Date().toISOString();
const localOf = (r) => localDate(Date.parse(r.starts_at));

function mock({ method, url, body, headers }) {
  const p = url.pathname.replace("/api/admin", "");
  requests.push({ method, path: p, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null, headers });
  if (p === "/me") return mode.me === "ok" ? { status: 200, json: { user: { email: OWNER, role: "owner" }, csrf_token: "mock-csrf", session_expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), idle_timeout_seconds: 1800 } } : err(401, "unauthenticated", "Please sign in.");
  if (p === "/tables") return { status: 200, json: { items: tables } };
  if (p === "/readiness") return { status: 200, json: { item: FIX.readiness } };
  if (p === "/audit-log") return { status: 200, json: { items: FIX.audit } };
  if (method !== "GET" && mode.expireOnWrite) return err(401, "unauthenticated", "Please sign in.");
  if (method !== "GET" && (headers["X-Requested-With"] !== "newscafe-admin" || headers["X-CSRF-Token"] !== "mock-csrf" || headers["Origin"] !== SITE)) return err(403, "csrf_token", "Missing or invalid CSRF token.");
  if (p === "/reservations" && method === "GET") {
    const q = url.searchParams; const limit = Number(q.get("limit") ?? 50), offset = Number(q.get("offset") ?? 0); const needle = (q.get("q") ?? "").toLowerCase();
    const list = rows.filter((r) => (q.get("include_test") === "true" || !r.is_test) && (!q.get("status") || r.status === q.get("status")) && (!q.get("from") || localOf(r) >= q.get("from")) && (!q.get("to") || localOf(r) <= q.get("to"))
      && (!needle || [r.guest_name, r.guest_email ?? "", r.guest_phone ?? "", r.reference].some((v) => v.toLowerCase().includes(needle)))).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
    return { status: 200, json: { items: list.slice(offset, offset + limit), has_more: list.length > offset + limit } };
  }
  const m = /^\/reservations\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/.exec(p);
  if (!m) return err(404, "not_found", "Not found.");
  const r = byId.get(m[1]);
  if (!r) return err(404, "not_found", MSG.not_found);
  const act = m[2];
  if (method === "GET" && !act) return { status: 200, json: { reservation: r } };
  if (method === "POST" && ["confirm", "cancel", "complete", "no-show", "reinstate"].includes(act)) {
    if (mode.unknownOutcomeFor === r.id) { mode.unknownOutcomeFor = null; return err(503, "outcome_unknown", "The result could not be confirmed."); }
    if (mode.staleStatusFor === r.id) { mode.staleStatusFor = null; return err(409, "status_change_not_allowed", MSG.status_change_not_allowed); }
    const ok = { confirm: r.status === "pending", cancel: ["pending", "confirmed"].includes(r.status), complete: r.status === "confirmed", "no-show": r.status === "confirmed", reinstate: ["cancelled", "no_show"].includes(r.status) }[act];
    if (!ok) return err(409, "status_change_not_allowed", MSG.status_change_not_allowed);
    const reason = body ? JSON.parse(body).reason : undefined;
    if (act === "confirm") { r.status = "confirmed"; r.confirmed_at = nowIso(); }
    if (act === "cancel") { r.status = "cancelled"; r.cancelled_at = nowIso(); r.cancel_reason = reason ?? null; r.tables = []; }
    if (act === "complete") r.status = "completed";
    if (act === "no-show") { r.status = "no_show"; r.tables = []; }
    if (act === "reinstate") { r.status = r.confirmed_at ? "confirmed" : "pending"; r.cancelled_at = null; r.cancel_reason = null; r.tables = ["T01"]; }
    r.updated_at = nowIso();
    return { status: 200, json: { reservation: r } };
  }
  if (method === "PATCH" && !act) {
    const b = JSON.parse(body ?? "{}"); const allowed = ["guest_name", "guest_email", "guest_phone", "notes"];
    if (Object.keys(b).length === 0 || Object.keys(b).some((k) => !allowed.includes(k))) return err(422, "validation_failed", "The request is not valid.");
    const next = { ...r, ...b };
    if (!next.guest_email && !next.guest_phone) return err(422, "invalid_input", MSG.invalid_input);
    Object.assign(r, b, { updated_at: nowIso() });
    return { status: 200, json: { reservation: r } };
  }
  if (method === "POST" && act === "move") {
    const b = JSON.parse(body ?? "{}");
    if (Object.keys(b).length === 0 || Object.keys(b).some((k) => !["starts_at", "party_size", "duration_minutes", "table_id"].includes(k))) return err(422, "validation_failed", "The request is not valid.");
    if (!["pending", "confirmed"].includes(r.status)) return err(409, "status_change_not_allowed", MSG.status_change_not_allowed);
    if (b.table_id === TAKEN_TABLE) return err(409, "table_taken", MSG.table_taken);          // all or nothing: nothing changed
    if (b.starts_at) { r.starts_at = new Date(b.starts_at).toISOString(); r.ends_at = new Date(Date.parse(r.starts_at) + r.duration_minutes * 60000).toISOString(); }
    if (b.party_size) r.party_size = b.party_size;
    if (b.duration_minutes) { r.duration_minutes = b.duration_minutes; r.ends_at = new Date(Date.parse(r.starts_at) + r.duration_minutes * 60000).toISOString(); }
    if (b.table_id) r.tables = [tables.find((t) => t.id === b.table_id)?.label ?? "T99"];
    r.updated_at = nowIso();
    return { status: 200, json: { reservation: r } };
  }
  return err(405, "method_not_allowed", "Method not allowed.");
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const b = await openBrowser({ port: 9336, outDir: OUT, site: SITE, mock });
const writes = () => requests.filter((x) => x.method !== "GET");
const lastWrite = () => writes().at(-1);
const text = () => b.text();
const has = async (s) => (await text()).includes(s);
const waitText = (s, t = 15000) => b.waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, t);
const q = (sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? null`);
const clickLink = (sel) => b.evaluate(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); if (!a) return false; a.click(); return true; })()`);
async function openBooking(r) {
  mode.me = "ok";
  await b.go(`/admin/reservations/${r.id}`);
  return b.waitFor(`document.querySelector('[data-testid=guest-name]')?.textContent === ${JSON.stringify(r.guest_name)}`);
}
const statusText = () => q("[data-testid=status]");
const nonTestInWindow = () => rows.filter((r) => !r.is_test && localOf(r) >= today && localOf(r) <= addDays(today, 13));

try {
  console.log(`Browser: ${b.version} (headless, throw-away profile, DevTools on 127.0.0.1:9336). The owner API is a stateful FAKE with fake data.`);
  console.log(`Fake data: ${rows.length} bookings (${rows.filter((r) => r.is_test).length} test), ${tables.length} tables, today = ${today}`);

  console.log("\n== R1  the list");
  await b.go("/admin");
  await b.waitFor("document.querySelector('h1')?.textContent === 'Overview'");
  check("the navigation shows Overview and Reservations, with the current page marked", await b.evaluate("[...document.querySelectorAll('nav[aria-label=\"Owner sections\"] a')].map((a) => a.textContent + (a.getAttribute('aria-current') ? '*' : '')).join()") === "Overview*,Reservations");
  await clickLink("nav[aria-label='Owner sections'] a[href='/admin/reservations']");
  check("clicking Reservations opens the list", await b.waitFor("location.pathname === '/admin/reservations' && document.querySelector('h1')?.textContent === 'Reservations'"));
  check("the list loads", await b.waitFor("!!document.querySelector('[data-testid=results] ol') || !!document.querySelector('[data-testid=empty]')"));
  const first = requests.filter((x) => x.path === "/reservations").at(-1).query;
  check("first request: today to today+13, test bookings off, 25 per page, offset 0, no search", first.from === today && first.to === addDays(today, 13) && first.include_test === "false" && first.limit === "25" && first.offset === "0" && !("q" in first) && !("status" in first), JSON.stringify(first));
  const expectAll = nonTestInWindow();
  check(`page 1 shows 25 of ${expectAll.length} bookings in the window`, (await b.evaluate("document.querySelectorAll('[data-testid=results] ol > li').length")) === 25 && (await q("[data-testid=range]")) === "Showing 1–25");
  check("test bookings are hidden and the page says so", (await has("Test bookings are hidden")) && !(await has("Test Guest")));
  await b.shot("list-default");

  console.log("\n== R2  paging and filters (each change asks the server once; nothing is put in the page address)");
  let c0 = requests.length;
  await b.clickButton("Next");
  check("Next asks for offset 25 and shows the rest", await b.waitFor("document.querySelector('[data-testid=range]')?.textContent.startsWith('Showing 26')") && requests.at(-1).query.offset === "25", JSON.stringify(requests.at(-1).query));
  for (let i = 0; i < 6 && await b.evaluate("![...document.querySelectorAll('button')].find((x) => x.textContent === 'Next').disabled"); i++) { await b.clickButton("Next"); await b.sleep(500); }
  check(`on the last page Next is disabled and the range ends at ${expectAll.length}`, await b.evaluate("[...document.querySelectorAll('button')].find((x) => x.textContent === 'Next').disabled === true") && (await q("[data-testid=range]")).endsWith("–" + expectAll.length), await q("[data-testid=range]"));
  for (let i = 0; i < 6 && await b.evaluate("![...document.querySelectorAll('button')].find((x) => x.textContent === 'Previous').disabled"); i++) { await b.clickButton("Previous"); await b.sleep(500); }
  check("Previous goes back to the first page (offset 0)", await b.waitFor("document.querySelector('[data-testid=range]')?.textContent.startsWith('Showing 1–')") && requests.at(-1).query.offset === "0");
  await b.setSelect("select[name=status]", "pending");
  const pend = rows.filter((r) => !r.is_test && r.status === "pending" && localOf(r) >= today && localOf(r) <= addDays(today, 13)).length;
  check("choosing a status asks for it and starts at the first page", await b.waitFor(`(() => { const li = [...document.querySelectorAll('[data-testid=results] ol > li')]; return li.length === ${pend} && li.every((x) => /pending/i.test(x.innerText)); })()`) && requests.at(-1).query.status === "pending" && requests.at(-1).query.offset === "0");
  check(`only pending bookings are listed (${pend})`, (await b.evaluate("document.querySelectorAll('[data-testid=results] ol > li').length")) === pend);
  await b.setSelect("select[name=status]", "");
  await b.setField("input[name=q]", "Pia"); await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()");
  check("searching sends the text once, only when submitted", await b.waitFor("document.querySelectorAll('[data-testid=results] ol > li').length === 1") && requests.at(-1).query.q === "Pia");
  const search1 = requests.length;
  await b.setField("input[name=q]", "Pia P");
  check("typing alone does not search (nothing is sent per keystroke)", requests.length === search1);
  await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()");
  await b.sleep(600);
  check("the search text is NOT in the page address or storage", (await b.evaluate("location.search")) === "" && (await b.evaluate("JSON.stringify([Object.keys(sessionStorage), Object.keys(localStorage).filter((k) => k !== 'nc-theme')])")) === "[[],[]]");
  await b.setField("input[name=q]", "zzzzzz-nothing"); await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()");
  check("no match shows a helpful empty state", await b.waitFor("!!document.querySelector('[data-testid=empty]')") && /No bookings match/.test(await q("[data-testid=empty]")));
  await b.shot("list-empty");
  await b.setField("input[name=q]", ""); await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()");
  await b.evaluate("document.querySelector('input[type=checkbox]').click()");
  check("'Include test bookings' asks the server with include_test=true and shows them", await b.waitFor("document.body.innerText.includes('Test Guest')") && requests.at(-1).query.include_test === "true");
  await b.setField("input[name=from]", addDays(today, 5)); await b.setField("input[name=to]", addDays(today, 2));
  check("a 'from' date after the 'to' date is explained and nothing is requested", await waitText("The 'from' date is after the 'to' date."));
  const before = requests.length; await b.sleep(600);
  check("…no request was made for the impossible range", requests.length === before);
  await b.clickButton("Reset");
  check("Reset restores today..., all statuses, test bookings hidden", await b.waitFor("document.querySelector('input[name=from]').value === " + JSON.stringify(today) + " && document.querySelector('input[name=to]').value === ''") && requests.at(-1).query.include_test === "false");
  void c0;

  console.log("\n== R3  opening a booking");
  await b.setField("input[name=q]", "Pia"); await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()");
  await b.waitFor("document.querySelectorAll('[data-testid=results] ol > li').length === 1");
  await clickLink("[data-testid=results] ol a");
  check("clicking a row opens that booking", await b.waitFor(`location.pathname === '/admin/reservations/${PIA.id}' && document.querySelector('[data-testid=guest-name]')?.textContent === 'Pia Pending'`));
  check("it shows the details: when, party, phone, e-mail, notes, status", (await has("4 guests")) && (await has("+27 00 000 7001")) && (await has("pia@example.invalid")) && (await has("Window seat please")) && /pending/i.test(await statusText()));
  check("the page asks for exactly this booking", requests.some((x) => x.method === "GET" && x.path === `/reservations/${PIA.id}`));
  await b.shot("detail-pending");
  await b.evaluate("history.back()");
  check("Back returns to the list with the search still applied (filters kept in memory)", await b.waitFor("location.pathname === '/admin/reservations' && document.querySelector('input[name=q]').value === 'Pia' && document.querySelectorAll('[data-testid=results] ol > li').length === 1"));

  console.log("\n== R4  status changes");
  await openBooking(PIA);
  check("a pending booking offers Confirm and Cancel only", await b.evaluate("[...document.querySelectorAll('section[aria-labelledby=actions-h] button')].map((x) => x.textContent).join('|')") === "Confirm booking|Cancel booking");
  c0 = writes().length;
  await b.clickButton("Confirm booking");
  check("Confirm sends one POST /confirm with the CSRF header, token and Origin", await b.waitFor("document.body.innerText.includes('Booking confirmed.')") && writes().length === c0 + 1 && lastWrite().path === `/reservations/${PIA.id}/confirm` && lastWrite().method === "POST" && lastWrite().headers["X-Requested-With"] === "newscafe-admin" && lastWrite().headers["X-CSRF-Token"] === "mock-csrf" && lastWrite().headers["Origin"] === SITE, JSON.stringify(lastWrite()?.headers));
  check("the status badge now says Confirmed and the buttons change", /confirmed/i.test(await statusText()) && (await b.evaluate("[...document.querySelectorAll('section[aria-labelledby=actions-h] button')].map((x) => x.textContent).join('|')")) === "Mark completed|Mark no-show|Cancel booking");
  c0 = writes().length;
  await b.clickButton("Cancel booking");
  check("Cancel first asks 'are you sure' and sends nothing yet", await waitText("Cancel this booking? The table becomes free") && writes().length === c0);
  await b.shot("cancel-confirmation");
  await b.clickButton("Keep the booking");
  check("'Keep the booking' closes the question and sends nothing", !(await has("Cancel this booking?")) && writes().length === c0 && /confirmed/i.test(await statusText()));
  await b.clickButton("Cancel booking"); await b.waitFor("!!document.querySelector('textarea[name=reason]')");
  await b.setField("textarea[name=reason]", "Guest rang to say they are unwell");
  await b.clickButton("Yes, cancel the booking");
  check("confirming sends POST /cancel with the reason", await b.waitFor("document.body.innerText.includes('Booking cancelled.')") && lastWrite().path === `/reservations/${PIA.id}/cancel` && lastWrite().body?.reason === "Guest rang to say they are unwell", JSON.stringify(lastWrite()));
  check("the booking shows Cancelled with its reason and offers Reinstate", /cancelled/i.test(await statusText()) && (await has("Reason: Guest rang to say they are unwell")) && (await b.evaluate("[...document.querySelectorAll('section[aria-labelledby=actions-h] button')].map((x) => x.textContent).join('|')")) === "Reinstate booking");
  await b.shot("detail-cancelled");
  await b.clickButton("Reinstate booking");
  check("Reinstate brings it back to where it was (it had been confirmed)", await b.waitFor("/confirmed/i.test(document.querySelector('[data-testid=status]')?.textContent ?? '')") && lastWrite().path === `/reservations/${PIA.id}/reinstate`);
  await openBooking(NOSHOW);
  await b.clickButton("Mark no-show");
  check("No-show also asks first, then POSTs /no-show without a body", await waitText("Mark this guest as a no-show?") && (await b.clickButton("Yes, mark as no-show"), await waitText("marked as a no-show")) && lastWrite().path === `/reservations/${NOSHOW.id}/no-show` && lastWrite().body === null);
  check("a no-show can be reinstated", (await b.evaluate("[...document.querySelectorAll('section[aria-labelledby=actions-h] button')].map((x) => x.textContent).join('|')")) === "Reinstate booking");
  await b.clickButton("Reinstate booking"); await b.waitFor("/confirmed/i.test(document.querySelector('[data-testid=status]')?.textContent ?? '')");
  await b.clickButton("Mark completed");
  check("Complete marks it completed and no further changes are offered", await b.waitFor("/completed/i.test(document.querySelector('[data-testid=status]')?.textContent ?? '')") && (await has("This booking is finished")) && !(await has("Edit guest details")));
  await openBooking(DONE);
  check("an already-completed booking offers no actions, edit or move", (await has("This booking is finished")) && !(await has("Move or change")) && !(await has("Edit guest details")));

  console.log("\n== R5  editing the guest's details (only what changed is sent)");
  await openBooking(CONRAD);
  await b.clickButton("Edit guest details");
  check("the form opens pre-filled", await b.waitFor("document.querySelector('input[name=name]')?.value === 'Conrad Confirmed'") && (await b.evaluate("document.querySelector('input[name=email]').value")) === "conrad@example.invalid");
  c0 = writes().length;
  await b.clickButton("Save details");
  check("saving with no changes says so and sends nothing", await waitText("Nothing has been changed.") && writes().length === c0);
  await b.setField("input[name=name]", "  Conrad C. Renamed  "); await b.clickButton("Save details");
  check("changing only the name sends PATCH with just guest_name (trimmed)", await waitText("Details saved.") && lastWrite().method === "PATCH" && JSON.stringify(lastWrite().body) === JSON.stringify({ guest_name: "Conrad C. Renamed" }) && lastWrite().headers["X-CSRF-Token"] === "mock-csrf", JSON.stringify(lastWrite()?.body));
  check("the heading shows the new name straight away", (await q("[data-testid=guest-name]")) === "Conrad C. Renamed");
  await b.clickButton("Edit guest details");
  c0 = writes().length;
  await b.setField("input[name=email]", ""); await b.setField("input[name=phone]", ""); await b.clickButton("Save details");
  check("clearing both e-mail and phone is refused on the page (one must remain), nothing sent", await waitText("Keep an e-mail address or a phone number") && writes().length === c0);
  await b.setField("input[name=phone]", "+27 00 000 7002"); await b.setField("input[name=email]", "not-an-email"); await b.clickButton("Save details");
  check("an invalid e-mail is explained on the page, nothing sent", await waitText("Enter a valid e-mail address, or leave it empty.") && writes().length === c0);
  await b.setField("input[name=email]", ""); await b.clickButton("Save details");
  check("clearing just the e-mail sends guest_email: null", await b.waitFor("document.body.innerText.includes('Details saved.')") && JSON.stringify(lastWrite().body) === JSON.stringify({ guest_email: null }), JSON.stringify(lastWrite()?.body));
  check("the booking now shows 'Not given' for the e-mail", /E-MAIL\s*Not given/i.test(await text()));
  await b.shot("edit-form");
  await openBooking(PHIL);
  await b.clickButton("Edit guest details"); await b.setField("input[name=phone]", ""); await b.clickButton("Save details");
  check("removing the only contact method (phone-only guest) is refused on the page", await waitText("Keep an e-mail address or a phone number"));

  console.log("\n== R6  moving a booking (only what changed; time is cafe time; all or nothing)");
  await openBooking(MOVE);
  await b.clickButton("Move or change");
  check("the move form opens with the current time and party size, and the tables to choose from", await b.waitFor("document.querySelectorAll('select[name=table] option').length > 10") && (await b.evaluate("document.querySelector('input[name=party]').value")) === "2");
  await b.clickButton("Save changes");
  check("saving without a change says so and sends nothing", await waitText("Nothing has been changed."));
  const newDay = addDays(today, 6);
  await b.setField("input[name=when]", `${newDay}T20:00`); await b.clickButton("Save changes");
  check("a new time is sent as +02:00 and the booking shows it", await waitText("Booking updated.") && lastWrite().path === `/reservations/${MOVE.id}/move` && JSON.stringify(lastWrite().body) === JSON.stringify({ starts_at: `${newDay}T20:00:00+02:00` }) && /20:00/.test(await q("[data-testid=when]")), JSON.stringify(lastWrite()?.body));
  await b.clickButton("Move or change");
  await b.waitFor("!!document.querySelector('input[name=party]')");
  await b.waitFor("document.querySelectorAll('select[name=table] option').length > 10"); await b.setField("input[name=party]", "6"); await b.setField("input[name=duration]", "120"); await b.setSelect("select[name=table]", tables[5].id); await b.clickButton("Save changes");
  check("party size, duration and a chosen table are sent together", await b.waitFor("document.body.innerText.includes('6 guests')") && JSON.stringify(lastWrite().body) === JSON.stringify({ party_size: 6, duration_minutes: 120, table_id: tables[5].id }) && (await has(tables[5].label)), JSON.stringify(lastWrite()?.body));
  await b.clickButton("Move or change"); await b.waitFor("!!document.querySelector('input[name=party]')");
  const w0 = writes().length;
  await b.setField("input[name=party]", "0"); await b.setField("input[name=duration]", "5"); await b.setField("input[name=when]", ""); await b.clickButton("Save changes");
  check("impossible values are explained on the page and nothing is sent", await waitText("Party size must be a whole number from 1 to 99.") && (await has("Duration must be 15 to 720 minutes")) && (await has("Enter a date and time.")) && writes().length === w0);
  await b.setField("input[name=party]", "2"); await b.setField("input[name=duration]", ""); await b.setField("input[name=when]", `${newDay}T20:00`);
  await b.waitFor("document.querySelectorAll('select[name=table] option').length > 10"); await b.setField("input[name=party]", "3"); await b.setSelect("select[name=table]", TAKEN_TABLE); await b.clickButton("Save changes");
  check("moving onto a table that is no longer free shows the server's plain message and changes nothing", await waitText("That table is no longer free.") && (await has("6 guests")) && !(await has("3 guests")));
  await b.shot("move-conflict");

  console.log("\n== R7  failures");
  await openBooking(UNK);
  mode.unknownOutcomeFor = UNK.id;
  await b.clickButton("Confirm booking");
  check("if the result of a change is unknown, the page says so and does not pretend", await waitText("We could not confirm whether that change was saved. Reload this booking to check before trying again.") && /pending/i.test(await statusText()));
  await b.shot("outcome-unknown");
  await openBooking(RACE);
  mode.staleStatusFor = RACE.id;
  await b.clickButton("Mark completed");
  check("a change another device already made is refused with the server's plain message", await waitText("That status change is not allowed."));
  await b.go(`/admin/reservations/00000000-0000-4000-8000-0000000fffff`);
  check("a booking that does not exist says so (no 'try again')", await waitText("could not be found") && !(await has("Try again")));
  const calls = requests.length;
  await b.go("/admin/reservations/not-a-booking-id");
  check("a malformed booking link is refused on the page without asking the server for it", await waitText("not a valid booking link") && !requests.slice(calls).some((x) => x.path.includes("not-a-booking-id")));
  await openBooking(EXP);
  mode.expireOnWrite = true; mode.me = "401";
  await b.clickButton("Mark completed");
  check("a session that ended during a change sends the owner to sign in", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('Your session ended. Please sign in again.')"), await b.url());
  mode.expireOnWrite = false;

  console.log("\n== R8  security and privacy");
  const bad = writes().filter((x) => x.headers["X-Requested-With"] !== "newscafe-admin" || x.headers["X-CSRF-Token"] !== "mock-csrf" || x.headers["Origin"] !== SITE);
  check(`all ${writes().length} changes carried the CSRF header, the token and the dashboard Origin`, writes().length >= 12 && bad.length === 0, JSON.stringify(bad[0]));
  check("every change went to one of the six reservation endpoints, nothing else", writes().every((x) => (x.method === "POST" && /^\/reservations\/[0-9a-f-]{36}\/(confirm|cancel|complete|no-show|reinstate|move)$/.test(x.path)) || (x.method === "PATCH" && /^\/reservations\/[0-9a-f-]{36}$/.test(x.path))));
  check("only the owner API was asked (me, reservations, tables, readiness, audit-log): never the public API", requests.every((x) => ["/me", "/reservations", "/tables", "/readiness", "/audit-log"].some((p) => x.path === p || x.path.startsWith("/reservations/"))));
  check("nothing from the bookings is kept in the browser's storage", (await b.evaluate("JSON.stringify([Object.keys(sessionStorage), Object.keys(localStorage).filter((k) => k !== 'nc-theme')])")) === "[[],[]]");
  mode.me = "ok"; await b.go("/admin/reservations"); await b.waitFor("!!document.querySelector('[data-testid=results] ol')");
  await b.setField("input[name=q]", "Guest 0"); await b.evaluate("document.querySelector('form[aria-label=\"Filter reservations\"]').requestSubmit()"); await b.waitFor("document.querySelectorAll('[data-testid=results] ol > li').length > 0");
  check("the list shows names and references but no e-mail addresses or phone numbers", !/@example\.invalid|\+27 00 000/.test((await text()).replaceAll(OWNER, "")));

  console.log("\n== R9  look and feel");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await b.sleep(500);
  check("phone width (390 px): the list does not scroll sideways", await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
  await b.shot("list-phone");
  await openBooking(CAROL); await b.sleep(400);
  check("phone width: the booking page does not scroll sideways", await b.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"));
  await b.clickButton("Edit guest details"); await b.sleep(300); await b.shot("detail-phone-edit");
  await b.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate("document.documentElement.setAttribute('data-theme','light')"); await b.sleep(300); await b.shot("detail-light"); await b.evaluate("document.documentElement.setAttribute('data-theme','dark')");
  const a11y = await b.evaluate(`(() => { const fields = [...document.querySelectorAll('input:not([type=checkbox]), select, textarea')]; return fields.length > 0 && fields.every((i) => i.labels && i.labels.length > 0) && document.querySelectorAll('h1').length === 1 && [...document.querySelectorAll('button')].every((x) => (x.getAttribute('aria-label') || x.textContent).trim().length > 0) && !!document.querySelector('main#main') && [...document.querySelectorAll('section')].every((s) => s.getAttribute('aria-labelledby')); })()`);
  check("accessibility basics on the booking page: every field labelled, one h1, named buttons, labelled sections, a main landmark", a11y === true);
  await openBooking(PIA);
  check("the booking page has no public navbar, footer or custom cursor", (await b.evaluate("document.querySelectorAll('footer').length")) === 0 && !(await has("Skip to content")));

  console.log("\n== R10  hygiene");
  const own = b.cdp.errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::|401|403|404|409|422|503/.test(e));
  check("no JavaScript exceptions or console errors from the reservation screens", own.length === 0, own.slice(0, 3).join(" | "));
  console.log(`      requests to other hosts that were blocked (nothing left this computer): ${[...b.blockedHosts].join(", ") || "none"}`);
} catch (e) {
  check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
} finally {
  await b.close();
  console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${total - failures}/${total} reservation UI checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
