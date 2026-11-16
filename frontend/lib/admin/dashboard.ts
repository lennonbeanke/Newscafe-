// Pure helpers for the owner dashboard overview. No React, no DOM, no network: unit-tested with `node --test`.
// Everything the overview shows is derived from read-only owner-API answers (reservations, readiness, tables, audit log).
// Nothing here stores anything.

/** The cafe's local time zone. The API filters reservations by LOCAL dates of the location, so "today" must be worked out here too. */
export const CAFE_TIME_ZONE = "Africa/Johannesburg";

export type ReservationStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
export interface Reservation {
  id: string; reference: string; status: ReservationStatus; party_size: number; starts_at: string;
  guest_name: string; source: string; is_test: boolean; tables: string[];
}
export interface Readiness {
  name: string; has_opening_hours: boolean; has_tables: boolean; has_slot_interval: boolean; has_duration_rule: boolean;
  has_booking_limits: boolean; auto_confirm_enabled: boolean; ready_for_online_requests: boolean; ready_for_auto_confirm: boolean;
}
export interface DiningTable { id: string; label: string; section: string | null; min_covers: number; max_covers: number; is_active: boolean; online_bookable: boolean }
export interface AuditRow { id: number; at: string; actor_email: string | null; action: string; entity_type: string; after: Record<string, unknown> | null }

const STATUSES = new Set<string>(["pending", "confirmed", "cancelled", "completed", "no_show"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

// ---- defensive parsing: the API's rows are loose records, so only what is understood is used --------------------------------------------

export function parseReservation(v: unknown): Reservation | null {
  if (!isObj(v)) return null;
  const { id, reference, status, party_size, starts_at, guest_name, source, is_test, tables } = v;
  if (!str(id) || !str(reference) || !str(status) || !STATUSES.has(status) || typeof party_size !== "number" || !Number.isFinite(party_size)) return null;
  if (!str(starts_at) || Number.isNaN(Date.parse(starts_at)) || !str(guest_name) || !str(source) || typeof is_test !== "boolean") return null;
  return { id, reference, status: status as ReservationStatus, party_size, starts_at, guest_name, source, is_test, tables: Array.isArray(tables) ? tables.filter(str) : [] };
}
export function parseReadiness(v: unknown): Readiness | null {
  if (!isObj(v)) return null;
  const keys = ["has_opening_hours", "has_tables", "has_slot_interval", "has_duration_rule", "has_booking_limits", "auto_confirm_enabled", "ready_for_online_requests", "ready_for_auto_confirm"] as const;
  if (!str(v["name"]) || keys.some((k) => typeof v[k] !== "boolean")) return null;
  return v as unknown as Readiness;
}
export function parseTable(v: unknown): DiningTable | null {
  if (!isObj(v) || !str(v["id"]) || !str(v["label"]) || typeof v["is_active"] !== "boolean" || typeof v["online_bookable"] !== "boolean") return null;
  return { id: v["id"], label: v["label"], section: str(v["section"]) ? v["section"] : null, min_covers: Number(v["min_covers"]) || 0, max_covers: Number(v["max_covers"]) || 0, is_active: v["is_active"], online_bookable: v["online_bookable"] };
}
export function parseAudit(v: unknown): AuditRow | null {
  if (!isObj(v) || (typeof v["id"] !== "number" && !str(v["id"])) || !str(v["at"]) || Number.isNaN(Date.parse(v["at"])) || !str(v["action"])) return null;
  return { id: Number(v["id"]), at: v["at"], actor_email: str(v["actor_email"]) ? v["actor_email"] : null, action: v["action"], entity_type: str(v["entity_type"]) ? v["entity_type"] : "", after: isObj(v["after"]) ? v["after"] : null };
}
/** Parses a list and says how many rows could not be understood (they are left out, never guessed at). */
export function parseList<T>(items: unknown, parse: (v: unknown) => T | null): { rows: T[]; skipped: number } {
  const list = Array.isArray(items) ? items : [];
  const rows: T[] = []; let skipped = 0;
  for (const it of list) { const p = parse(it); if (p) rows.push(p); else skipped++; }
  return { rows, skipped };
}

// ---- dates and times (all in the cafe's time zone) ----------------------------------------------------------------------------------------

/** "2026-11-12" for the given instant in the given zone. */
export const localDate = (at: Date | number, tz: string = CAFE_TIME_ZONE): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const formatTime = (iso: string, tz: string = CAFE_TIME_ZONE): string => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const formatDay = (date: string): string => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---- reservations -----------------------------------------------------------------------------------------------------------------------------

/** Bookings that take a seat (cancelled and no-show ones do not count as guests expected). */
export const isLive = (r: Reservation): boolean => r.status === "pending" || r.status === "confirmed" || r.status === "completed";

/** "Jane D." from "Jane Doe": enough to recognise a guest on a glance screen, without full names or any contact details. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  const first = parts[0] as string;
  const second = parts[1];
  return second ? `${first} ${second.charAt(0).toUpperCase()}.` : first;
}

export interface DaySummary { date: string; bookings: number; guests: number; pending: number; confirmed: number; next: Reservation | null }
export function summarizeDays(rows: Reservation[], days: string[], now: number, tz: string = CAFE_TIME_ZONE): DaySummary[] {
  return days.map((date) => {
    const mine = rows.filter((r) => isLive(r) && localDate(Date.parse(r.starts_at), tz) === date).sort(byStart);
    const upcoming = mine.find((r) => Date.parse(r.starts_at) >= now && r.status !== "completed") ?? null;
    return { date, bookings: mine.length, guests: mine.reduce((n, r) => n + r.party_size, 0), pending: mine.filter((r) => r.status === "pending").length, confirmed: mine.filter((r) => r.status === "confirmed").length, next: upcoming };
  });
}
export const byStart = (a: Reservation, b: Reservation): number => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.reference.localeCompare(b.reference);
export const forDate = (rows: Reservation[], date: string, tz: string = CAFE_TIME_ZONE): Reservation[] => rows.filter((r) => localDate(Date.parse(r.starts_at), tz) === date).sort(byStart);

export function splitTest(rows: Reservation[], includeTest: boolean): { shown: Reservation[]; hiddenTest: number } {
  return includeTest ? { shown: rows, hiddenTest: 0 } : { shown: rows.filter((r) => !r.is_test), hiddenTest: rows.filter((r) => r.is_test).length };
}

export const SOURCE_LABEL: Record<string, string> = { web: "Website", phone: "Phone", walk_in: "Walk-in", admin: "Staff", email: "E-mail" };
export const STATUS_LABEL: Record<ReservationStatus, string> = { pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed", no_show: "No-show" };

// ---- readiness and tables ---------------------------------------------------------------------------------------------------------------------

export function readinessChecklist(r: Readiness): { items: { label: string; ok: boolean }[]; ready: boolean; autoConfirm: boolean } {
  return {
    items: [
      { label: "Opening hours set", ok: r.has_opening_hours },
      { label: "Active tables set up", ok: r.has_tables },
      { label: "Booking time slots set", ok: r.has_slot_interval },
      { label: "Dining-time rule set", ok: r.has_duration_rule },
      { label: "Notice, advance and party-size limits set", ok: r.has_booking_limits },
    ],
    ready: r.ready_for_online_requests,
    autoConfirm: r.auto_confirm_enabled,
  };
}
export function tableStats(tables: DiningTable[]): { total: number; active: number; online: number; seats: number; sections: { name: string; count: number }[] } {
  const active = tables.filter((t) => t.is_active);
  const map = new Map<string, number>();
  for (const t of active) { const k = t.section ?? "Other"; map.set(k, (map.get(k) ?? 0) + 1); }
  return {
    total: tables.length, active: active.length, online: active.filter((t) => t.online_bookable).length, seats: active.reduce((n, t) => n + t.max_covers, 0),
    sections: [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---- activity ---------------------------------------------------------------------------------------------------------------------------------

export type Tone = "normal" | "good" | "warn" | "bad";
export interface Activity { text: string; tone: Tone; kind: "security" | "booking" | "other" }
// Older events from the former two-step sign-in (password_ok, second_factor_failed, recovery codes, authenticator) are kept here so the history stays readable.
const AUTH: Record<string, Activity> = {
  "auth.login": { text: "Owner signed in", tone: "good", kind: "security" },
  "auth.logout": { text: "Owner signed out", tone: "normal", kind: "security" },
  "auth.password_ok": { text: "Password accepted (older two-step sign-in)", tone: "normal", kind: "security" },
  "auth.login_failed": { text: "Failed sign-in attempt", tone: "warn", kind: "security" },
  "auth.second_factor_failed": { text: "Wrong second-step code (older two-step sign-in)", tone: "warn", kind: "security" },
  "auth.locked": { text: "Account locked after repeated failures", tone: "bad", kind: "security" },
  "auth.recovery_code_used": { text: "Recovery code used (older two-step sign-in)", tone: "warn", kind: "security" },
  "auth.totp_enrolled": { text: "Authenticator app set up (older two-step sign-in)", tone: "good", kind: "security" },
  "auth.recovery_codes_regenerated": { text: "Recovery codes regenerated (older two-step sign-in)", tone: "normal", kind: "security" },
  "reservation.view": { text: "A booking was opened", tone: "normal", kind: "booking" },
  "reservation.history_view": { text: "A booking's history was opened", tone: "normal", kind: "booking" },
  "reservation.create": { text: "Staff booking created", tone: "good", kind: "booking" },
  "reservation.edit": { text: "Booking details edited", tone: "normal", kind: "booking" },
  "reservation.move": { text: "Booking moved", tone: "normal", kind: "booking" },
  "dev.owner_password_reset": { text: "Development password reset", tone: "warn", kind: "security" },
};
const STATUS_VERB: Record<string, string> = { confirmed: "confirmed", cancelled: "cancelled", completed: "marked completed", no_show: "marked no-show", pending: "set to pending" };

/** Plain-language line for an audit row. Only the new status of a booking is ever read from `after`; no other stored detail is shown. */
export function describeActivity(row: AuditRow): Activity {
  if (row.action === "reservation.status") {
    const s = row.after && typeof row.after["status"] === "string" ? row.after["status"] : null;
    return { text: s && STATUS_VERB[s] ? `Booking ${STATUS_VERB[s]}` : "Booking status changed", tone: s === "cancelled" || s === "no_show" ? "warn" : "normal", kind: "booking" };
  }
  const known = AUTH[row.action];
  if (known) return known;
  const readable = row.action.replace(/[._]+/g, " ").trim();
  return { text: readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : "Activity", tone: "normal", kind: "other" };
}

/** Failed sign-ins (a wrong password, or an older wrong second-step code) and lock-outs among the rows given, in the last 24 hours. */
export function securitySummary(rows: AuditRow[], now: number): { failedSignIns: number; lockouts: number; window: number } {
  const recent = rows.filter((r) => now - Date.parse(r.at) <= 24 * 3600 * 1000);
  const count = (a: string) => recent.filter((r) => r.action === a).length;
  return { failedSignIns: count("auth.login_failed") + count("auth.second_factor_failed"), lockouts: count("auth.locked"), window: rows.length };
}
