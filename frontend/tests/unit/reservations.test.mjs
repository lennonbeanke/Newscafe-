// Unit tests for the reservation-management helpers (fake data only).   node --test "tests/unit/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAFE_TIME_ZONE } from "../../lib/admin/dashboard.ts";
import { friendlyMessage } from "../../lib/admin/pure.ts";
import {
  ACTIONS_FOR, buildEditPatch, buildListQuery, buildMoveBody, CAFE_TZ, cafeLocalToIso, canEdit, canMove, cleanSearch, dateRangeProblem, editFormOf, isoToCafeLocal,
  moveFormOf, NEEDS_CONFIRMATION, PAGE_SIZE, parseReservationFull, STATUSES, UUID_RE,
} from "../../lib/admin/reservations.ts";

// A row exactly as the owner API returns it (fake guest).
const REAL = { id: "0bb2f3af-be23-4dfc-aadf-708949f9e3bd", reference: "7DD7EEDF", status: "confirmed", party_size: 3, starts_at: "2026-11-13T16:30:00+00:00", ends_at: "2026-11-13T18:00:00+00:00", duration_minutes: 90, guest_name: "Test Guest 021", guest_email: "test.guest.021@example.invalid", guest_phone: "+27 00 000 0021", notes: "Fake development booking", source: "admin", is_test: true, consent_at: "2026-11-12T07:36:27+00:00", created_at: "2026-11-12T07:36:27+00:00", updated_at: "2026-11-12T07:36:27+00:00", confirmed_at: "2026-11-12T07:36:27+00:00", cancelled_at: null, cancel_reason: null, tables: ["T22"] };
const res = (o = {}) => parseReservationFull({ ...REAL, ...o });

describe("shared constants", () => {
  it("uses the same cafe time zone as the dashboard", () => assert.equal(CAFE_TZ, CAFE_TIME_ZONE));
  it("South Africa really is UTC+2 all year (so the fixed offset is right)", () => {
    for (const d of ["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"]) assert.equal(isoToCafeLocal(d), `${d.slice(0, 10)}T14:00`);
  });
});

describe("parsing a full reservation", () => {
  it("reads a real row, including empty contact fields as null", () => {
    const r = res();
    assert.equal(r.guest_email, "test.guest.021@example.invalid");
    assert.deepEqual(r.tables, ["T22"]);
    const e = res({ guest_email: null, guest_phone: "", notes: null, cancelled_at: null });
    assert.equal(e.guest_email, null); assert.equal(e.guest_phone, null); assert.equal(e.notes, null);
  });
  it("rejects what it cannot understand", () => {
    for (const bad of [null, [], {}, { ...REAL, id: "not-a-uuid" }, { ...REAL, status: "weird" }, { ...REAL, party_size: "3" }, { ...REAL, starts_at: "nope" }, { ...REAL, ends_at: 5 }, { ...REAL, is_test: "no" }, { ...REAL, guest_name: null }, { ...REAL, duration_minutes: NaN }])
      assert.equal(parseReservationFull(bad), null, JSON.stringify(bad)?.slice(0, 50));
  });
  it("only accepts real UUIDs as ids (so an id can never change a request path)", () => {
    assert.ok(UUID_RE.test(REAL.id));
    for (const bad of ["", "../me", "00000000-0000-4000-8000-00000000000g", `${REAL.id}/cancel`, `${REAL.id}?x=1`, " " + REAL.id]) assert.equal(UUID_RE.test(bad), false, bad);
  });
});

describe("which actions are offered", () => {
  it("covers every status the API has", () => assert.deepEqual(Object.keys(ACTIONS_FOR).sort(), [...STATUSES].sort()));
  it("offers sensible actions only", () => {
    assert.deepEqual(ACTIONS_FOR.pending, ["confirm", "cancel"]);
    assert.deepEqual(ACTIONS_FOR.confirmed, ["complete", "no-show", "cancel"]);
    assert.deepEqual(ACTIONS_FOR.cancelled, ["reinstate"]);
    assert.deepEqual(ACTIONS_FOR.no_show, ["reinstate"]);
    assert.deepEqual(ACTIONS_FOR.completed, []);
  });
  it("asks twice before releasing a table", () => { assert.ok(NEEDS_CONFIRMATION.has("cancel")); assert.ok(NEEDS_CONFIRMATION.has("no-show")); assert.equal(NEEDS_CONFIRMATION.has("confirm"), false); });
  it("allows moving only live bookings and editing anything not finished", () => {
    assert.deepEqual(STATUSES.filter(canMove), ["pending", "confirmed"]);
    assert.deepEqual(STATUSES.filter((s) => !canEdit(s)), ["completed"]);
  });
});

describe("cafe-local time for the move form", () => {
  it("converts typed local time to an instant with the +02:00 offset", () => assert.equal(cafeLocalToIso("2026-11-14T19:30"), "2026-11-14T19:30:00+02:00"));
  it("refuses things that are not a real date and time", () => {
    for (const bad of ["", "2026-11-14", "2026-11-14 19:30", "2026-13-01T10:00", "2026-02-30T10:00", "2026-11-14T25:00", "2026-11-14T10:61", "garbage"]) assert.equal(cafeLocalToIso(bad), null, bad);
  });
  it("round-trips an instant to the field value and back", () => {
    assert.equal(isoToCafeLocal("2026-11-13T16:30:00+00:00"), "2026-11-13T18:30");
    assert.equal(isoToCafeLocal("2026-11-13T22:15:00Z"), "2026-11-14T00:15");
    assert.equal(Date.parse(cafeLocalToIso(isoToCafeLocal("2026-11-13T16:30:00Z"))), Date.parse("2026-11-13T16:30:00Z"));
  });
});

describe("list filters become a safe query", () => {
  const f = { from: "2026-11-13", to: "2026-11-20", status: "", q: "", includeTest: false };
  it("always sends include_test, a page size and an offset", () => assert.deepEqual(buildListQuery(f, 0), { include_test: "false", limit: PAGE_SIZE, offset: 0, from: "2026-11-13", to: "2026-11-20" }));
  it("adds status and search only when valid", () => {
    assert.deepEqual(buildListQuery({ ...f, status: "pending", q: "  Jane   Doe ", includeTest: true }, 50), { include_test: "true", limit: PAGE_SIZE, offset: 50, from: "2026-11-13", to: "2026-11-20", status: "pending", q: "Jane Doe" });
    const bad = buildListQuery({ from: "13/11/2026", to: "", status: "hacked", q: "a\u0000b", includeTest: false }, -5);
    assert.deepEqual(bad, { include_test: "false", limit: PAGE_SIZE, offset: 0 });
  });
  it("caps and cleans the search text", () => { assert.equal(cleanSearch("x".repeat(500)).length, 100); assert.equal(cleanSearch("  a \n b  "), "a b"); });
  it("explains a bad date range", () => {
    assert.equal(dateRangeProblem("2026-11-13", "2026-11-12"), "The 'from' date is after the 'to' date.");
    assert.equal(dateRangeProblem("", ""), null); assert.equal(dateRangeProblem("2026-11-13", ""), null); assert.match(dateRangeProblem("x", ""), /not valid/);
  });
});

describe("edit form: only what changed, nothing the API would refuse", () => {
  const orig = res();
  const form = (o = {}) => ({ ...editFormOf(orig), ...o });
  it("sends nothing when nothing changed", () => { const r = buildEditPatch(orig, form()); assert.deepEqual(r.patch, {}); assert.deepEqual(r.errors, {}); });
  it("sends only the changed fields", () => assert.deepEqual(buildEditPatch(orig, form({ name: "  Renamed Person ", notes: "allergy: nuts" })).patch, { guest_name: "Renamed Person", notes: "allergy: nuts" }));
  it("clears an e-mail or note with null", () => {
    assert.deepEqual(buildEditPatch(orig, form({ email: "" })).patch, { guest_email: null });
    assert.deepEqual(buildEditPatch(orig, form({ notes: "   " })).patch, { notes: null });
  });
  it("keeps one way to reach the guest", () => {
    assert.match(buildEditPatch(orig, form({ email: "", phone: "" })).errors.email, /e-mail address or a phone number/);
    const phoneOnly = res({ guest_email: null });
    assert.deepEqual(buildEditPatch(phoneOnly, { ...editFormOf(phoneOnly), phone: "" }).errors.email !== undefined, true);
    assert.deepEqual(buildEditPatch(phoneOnly, { ...editFormOf(phoneOnly), email: "a@b.co" }).errors, {});
  });
  it("checks each field with plain messages", () => {
    const e = buildEditPatch(orig, form({ name: "   ", email: "not-an-email", phone: "abc", notes: "x".repeat(501) })).errors;
    assert.match(e.name, /name/i); assert.match(e.email, /valid e-mail/); assert.match(e.phone, /digits/); assert.match(e.notes, /too long/);
    assert.match(buildEditPatch(orig, form({ name: "x".repeat(101) })).errors.name, /too long/);
    assert.match(buildEditPatch(orig, form({ name: "a\u0007b" })).errors.name, /not allowed/);
    assert.match(buildEditPatch(orig, form({ notes: "a\u0000b" })).errors.notes, /not allowed/);
  });
  it("lets multi-line notes through", () => assert.deepEqual(buildEditPatch(orig, form({ notes: "line one\nline two" })).patch, { notes: "line one\nline two" }));
});

describe("move form: only what changed, time read as cafe time", () => {
  const orig = res();                                               // 18:30 local, party 3, 90 min
  const form = (o = {}) => ({ ...moveFormOf(orig), ...o });
  const TABLE = "11111111-2222-4333-8444-555555555555";
  it("starts from the booking's own values and reports 'nothing changed'", () => {
    assert.deepEqual(moveFormOf(orig), { when: "2026-11-13T18:30", party: "3", duration: "", tableId: "" });
    const r = buildMoveBody(orig, form()); assert.deepEqual(r.body, {}); assert.equal(r.errors.form, "Nothing has been changed.");
  });
  it("sends a new time with the +02:00 offset", () => assert.deepEqual(buildMoveBody(orig, form({ when: "2026-11-14T20:00" })).body, { starts_at: "2026-11-14T20:00:00+02:00" }));
  it("sends party size, duration and table when they differ or are chosen", () => {
    assert.deepEqual(buildMoveBody(orig, form({ party: "5", duration: "120", tableId: TABLE })).body, { party_size: 5, duration_minutes: 120, table_id: TABLE });
    assert.deepEqual(buildMoveBody(orig, form({ party: "3", duration: "90" })).body, {});   // same as now: nothing to send
  });
  it("refuses impossible input before asking the server", () => {
    const e = buildMoveBody(orig, form({ when: "", party: "0", duration: "5", tableId: "x" })).errors;
    assert.ok(e.when && e.party && e.duration && e.tableId);
    for (const p of ["", "abc", "100", "-1", "2.5"]) assert.ok(buildMoveBody(orig, form({ party: p })).errors.party, p);
    for (const d of ["14", "721", "9999", "ab"]) assert.ok(buildMoveBody(orig, form({ duration: d })).errors.duration, d);
    assert.ok(buildMoveBody(orig, form({ when: "2026-02-30T10:00" })).errors.when);
  });
});

describe("plain messages for the failures a change can hit", () => {
  const m = (status, code, apiMessage) => friendlyMessage({ status, code, apiMessage });
  it("says plainly when the result of a change is unknown", () => assert.match(m(503, "outcome_unknown"), /could not confirm whether that change was saved.*before trying again/));
  it("handles a booking that does not exist", () => assert.match(m(404, "not_found"), /could not be found/));
  it("passes on the server's own short, safe wording for conflicts", () => {
    assert.equal(m(409, "table_taken", "That table is no longer free."), "That table is no longer free.");
    assert.equal(m(409, "status_change_not_allowed", "That status change is not allowed."), "That status change is not allowed.");
    assert.equal(m(409, "no_availability", "No table is available for that."), "No table is available for that.");
  });
  it("never shows SQL or long server text", () => assert.equal(m(409, "weird", "SELECT * FROM reservations ".repeat(20)), "Something went wrong. Please try again."));
});
