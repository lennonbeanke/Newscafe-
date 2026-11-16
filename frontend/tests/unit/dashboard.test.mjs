// Unit tests for the dashboard overview helpers (fake data only).   node --test "tests/admin/*.test.mjs"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays, describeActivity, formatDay, formatTime, forDate, localDate, parseAudit, parseList, parseReadiness, parseReservation, parseTable, readinessChecklist,
  relativeTime, securitySummary, shortName, splitTest, summarizeDays, tableStats,
} from "../../lib/admin/dashboard.ts";

// A row exactly as the owner API returns it from the development database (fake guest).
const REAL = { id: "0bb2f3af-be23-4dfc-aadf-708949f9e3bd", reference: "7DD7EEDF", status: "confirmed", party_size: 3, starts_at: "2026-11-13T16:30:00+00:00", ends_at: "2026-11-13T18:00:00+00:00", duration_minutes: 90, guest_name: "Test Guest 021", guest_email: "test.guest.021@example.invalid", guest_phone: "+27 00 000 0021", notes: "Fake development booking", source: "admin", is_test: true, consent_at: "2026-11-12T07:36:27.80887+00:00", created_at: "2026-11-12T07:36:27.80887+00:00", updated_at: "2026-11-12T07:36:27.80887+00:00", confirmed_at: "2026-11-12T07:36:27.80887+00:00", cancelled_at: null, cancel_reason: null, tables: ["T22"] };
const row = (o = {}) => parseReservation({ ...REAL, ...o });
let n = 0;
const make = (o = {}) => row({ id: `id-${++n}`, reference: `REF${String(n).padStart(5, "0")}`, ...o });
const T = "Africa/Johannesburg";

describe("parsing what the API returns", () => {
  it("reads a real reservation row and keeps only what the overview needs (no e-mail, phone or notes)", () => {
    const r = parseReservation(REAL);
    assert.ok(r);
    assert.deepEqual(Object.keys(r).sort(), ["guest_name", "id", "is_test", "party_size", "reference", "source", "starts_at", "status", "tables"]);
    assert.doesNotMatch(JSON.stringify(r), /example\.invalid|\+27|Fake development/);
  });
  it("rejects rows it cannot understand instead of guessing", () => {
    for (const bad of [null, "x", [], {}, { ...REAL, status: "weird" }, { ...REAL, starts_at: "not a date" }, { ...REAL, party_size: "3" }, { ...REAL, is_test: "yes" }, { ...REAL, id: 5 }, { ...REAL, guest_name: null }])
      assert.equal(parseReservation(bad), null, JSON.stringify(bad)?.slice(0, 60));
  });
  it("counts skipped rows", () => {
    const p = parseList([REAL, { nope: 1 }, REAL, null], parseReservation);
    assert.equal(p.rows.length, 2); assert.equal(p.skipped, 2);
    assert.deepEqual(parseList(undefined, parseReservation), { rows: [], skipped: 0 });
  });
  it("understands the readiness, table and audit rows", () => {
    assert.ok(parseReadiness({ location_id: "x", name: "N", has_opening_hours: true, has_tables: true, has_slot_interval: true, has_duration_rule: true, has_booking_limits: true, auto_confirm_enabled: false, ready_for_online_requests: true, ready_for_auto_confirm: true }));
    assert.equal(parseReadiness({ name: "N" }), null);
    assert.equal(parseTable({ id: "a", label: "T01", section: "Window", min_covers: 1, max_covers: 2, is_active: true, online_bookable: true })?.label, "T01");
    assert.equal(parseTable({ id: "a" }), null);
    assert.equal(parseAudit({ id: 7, at: "2026-11-12T15:15:17Z", actor_email: null, action: "auth.login", entity_type: "admin_user", after: { method: "totp" } })?.id, 7);
    assert.equal(parseAudit({ id: 7, at: "nope", action: "x" }), null);
  });
});

describe("dates are the cafe's local dates (Africa/Johannesburg, UTC+2)", () => {
  it("rolls over at local midnight, not UTC midnight", () => {
    assert.equal(localDate(Date.parse("2026-11-12T21:59:00Z"), T), "2026-11-12");
    assert.equal(localDate(Date.parse("2026-11-12T22:00:00Z"), T), "2026-11-13");
  });
  it("adds days across month and year ends", () => {
    assert.equal(addDays("2026-11-28", 3), "2026-12-01");
    assert.equal(addDays("2026-12-30", 3), "2027-01-02");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });
  it("shows times in local time", () => { assert.equal(formatTime("2026-11-13T16:30:00+00:00", T), "18:30"); assert.equal(formatTime("2026-11-13T22:15:00Z", T), "00:15"); });
  it("formats a day readably", () => assert.match(formatDay("2026-11-13"), /Fri.*13.*Nov/));
  it("describes how long ago something happened", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    assert.equal(relativeTime("2026-11-12T11:59:40Z", now), "just now");
    assert.equal(relativeTime("2026-11-12T11:55:00Z", now), "5 min ago");
    assert.equal(relativeTime("2026-11-12T09:00:00Z", now), "3 h ago");
    assert.equal(relativeTime("2026-11-10T12:00:00Z", now), "2 d ago");
    assert.equal(relativeTime("2026-11-13T12:00:00Z", now), "just now");   // never negative
  });
});

describe("day summaries", () => {
  const now = Date.parse("2026-11-13T09:00:00Z");   // 11:00 local on Friday 13 Nov
  const days = [0, 1, 2].map((i) => addDays("2026-11-13", i));
  const rows = [
    make({ starts_at: "2026-11-13T07:00:00Z", party_size: 2, status: "completed" }),                  // 09:00 local, already done
    make({ starts_at: "2026-11-13T17:00:00Z", party_size: 4, status: "confirmed" }),                  // 19:00
    make({ starts_at: "2026-11-13T15:00:00Z", party_size: 3, status: "pending" }),                    // 17:00
    make({ starts_at: "2026-11-13T15:00:00Z", party_size: 9, status: "cancelled" }),                  // not counted
    make({ starts_at: "2026-11-13T16:00:00Z", party_size: 5, status: "no_show" }),                    // not counted
    make({ starts_at: "2026-11-13T22:30:00Z", party_size: 6, status: "confirmed" }),                  // 00:30 local on the 14th
    make({ starts_at: "2026-11-15T10:00:00Z", party_size: 2, status: "confirmed" }),
  ];
  const s = summarizeDays(rows, days, now, T);
  it("counts bookings and guests per local day, leaving out cancelled and no-show", () => {
    assert.deepEqual(s.map((d) => [d.date, d.bookings, d.guests]), [["2026-11-13", 3, 9], ["2026-11-14", 1, 6], ["2026-11-15", 1, 2]]);
  });
  it("splits confirmed and pending and finds the next arrival", () => {
    assert.equal(s[0].pending, 1); assert.equal(s[0].confirmed, 1);
    assert.equal(formatTime(s[0].next.starts_at, T), "17:00");
  });
  it("lists a day's bookings in time order", () => assert.deepEqual(forDate(rows, "2026-11-13", T).map((r) => formatTime(r.starts_at, T)), ["09:00", "17:00", "17:00", "18:00", "19:00"]));
  it("has no 'next' for an empty day", () => assert.equal(summarizeDays([], ["2026-11-20"], now, T)[0].next, null));
});

describe("privacy on a glance screen", () => {
  it("shows a short name only", () => {
    assert.equal(shortName("Jane Doe"), "Jane D.");
    assert.equal(shortName("Jane"), "Jane");
    assert.equal(shortName("  maria   van der Merwe "), "maria V.");
    assert.equal(shortName(""), "Guest");
    assert.equal(shortName("Test Guest 021"), "Test G.");
  });
});

describe("test bookings", () => {
  const rows = [make({ is_test: true }), make({ is_test: true }), make({ is_test: false })];
  it("hides them by default and says how many", () => { const x = splitTest(rows, false); assert.equal(x.shown.length, 1); assert.equal(x.hiddenTest, 2); });
  it("shows them on request", () => { const x = splitTest(rows, true); assert.equal(x.shown.length, 3); assert.equal(x.hiddenTest, 0); });
});

describe("readiness and tables", () => {
  const base = { name: "N", has_opening_hours: true, has_tables: true, has_slot_interval: true, has_duration_rule: true, has_booking_limits: true, auto_confirm_enabled: false, ready_for_online_requests: true, ready_for_auto_confirm: true };
  it("builds a checklist and reports what is missing", () => {
    const ok = readinessChecklist(base);
    assert.equal(ok.ready, true); assert.equal(ok.items.length, 5); assert.ok(ok.items.every((i) => i.ok)); assert.equal(ok.autoConfirm, false);
    const bad = readinessChecklist({ ...base, has_tables: false, ready_for_online_requests: false });
    assert.equal(bad.ready, false); assert.deepEqual(bad.items.filter((i) => !i.ok).map((i) => i.label), ["Active tables set up"]);
  });
  it("counts active, online-bookable tables, seats and sections", () => {
    const t = (label, section, max, active = true, online = true) => parseTable({ id: label, label, section, min_covers: 1, max_covers: max, is_active: active, online_bookable: online });
    const s = tableStats([t("T1", "Window", 2), t("T2", "Window", 2), t("T3", "Bar", 4, true, false), t("T4", "Bar", 6, false), t("T5", null, 2)]);
    assert.deepEqual([s.total, s.active, s.online, s.seats], [5, 4, 3, 10]);
    assert.deepEqual(s.sections, [{ name: "Bar", count: 1 }, { name: "Other", count: 1 }, { name: "Window", count: 2 }]);
  });
});

describe("recent activity", () => {
  const a = (action, extra = {}) => parseAudit({ id: ++n, at: "2026-11-12T10:00:00Z", actor_email: "dev-owner@example.invalid", action, entity_type: "x", after: null, ...extra });
  it("puts known events into plain language", () => {
    assert.equal(describeActivity(a("auth.login")).text, "Owner signed in");
    assert.equal(describeActivity(a("auth.locked")).tone, "bad");
    assert.equal(describeActivity(a("auth.login_failed")).tone, "warn");
    assert.equal(describeActivity(a("reservation.create")).kind, "booking");
  });
  it("reads only the new status of a booking, nothing else stored with the event", () => {
    const d = describeActivity(a("reservation.status", { after: { status: "cancelled", guest_name: "Jane Doe", email: "jane@example.com" } }));
    assert.equal(d.text, "Booking cancelled"); assert.doesNotMatch(JSON.stringify(d), /Jane|jane@/);
    assert.equal(describeActivity(a("reservation.status", { after: { status: "mystery" } })).text, "Booking status changed");
    assert.equal(describeActivity(a("reservation.status")).text, "Booking status changed");
  });
  it("makes unknown events readable and never fails", () => {
    assert.equal(describeActivity(a("something.new_happened")).text, "Something new happened");
    assert.equal(describeActivity(a("")).text, "Activity");
  });
  it("summarises failed sign-ins in the last 24 hours only", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const rows = [a("auth.login_failed", { at: "2026-11-12T11:00:00Z" }), a("auth.second_factor_failed", { at: "2026-11-12T01:00:00Z" }), a("auth.login_failed", { at: "2026-11-10T11:00:00Z" }),
      a("auth.locked", { at: "2026-11-12T11:30:00Z" }), a("auth.login", { at: "2026-11-12T11:32:00Z" })];
    assert.deepEqual(securitySummary(rows, now), { failedSignIns: 2, lockouts: 1, window: 5 });
    assert.deepEqual(securitySummary([], now), { failedSignIns: 0, lockouts: 0, window: 0 });
  });
});
