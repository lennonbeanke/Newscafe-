// Pure helpers for the reservation-management screens: parsing what the owner API returns, which actions make sense for which status,
// and turning the edit / move forms into the exact request bodies the API accepts (only what changed).
// No React, no DOM, no network, no storage. Unit-tested with `node --test`. (Self-contained on purpose: tests load it without a bundler.)

/** The cafe's time zone: South Africa Standard Time, UTC+2 all year (no daylight saving). Must equal CAFE_TIME_ZONE in dashboard.ts (tested). */
export const CAFE_TZ = "Africa/Johannesburg";
export const CAFE_UTC_OFFSET = "+02:00";
export const PAGE_SIZE = 25;

export type Status = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
export const STATUSES: Status[] = ["pending", "confirmed", "cancelled", "completed", "no_show"];
export const STATUS_TEXT: Record<Status, string> = { pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed", no_show: "No-show" };
export const SOURCE_TEXT: Record<string, string> = { web: "Website", phone: "Phone", walk_in: "Walk-in", admin: "Staff", email: "E-mail" };

export interface ReservationFull {
  id: string; reference: string; status: Status; party_size: number; starts_at: string; ends_at: string; duration_minutes: number;
  guest_name: string; guest_email: string | null; guest_phone: string | null; notes: string | null; source: string; is_test: boolean;
  consent_at: string | null; created_at: string; updated_at: string; confirmed_at: string | null; cancelled_at: string | null; cancel_reason: string | null; tables: string[];
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isoOrNull = (v: unknown): string | null => (isStr(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const strOrNull = (v: unknown): string | null => (isStr(v) && v !== "" ? v : null);

export function parseReservationFull(v: unknown): ReservationFull | null {
  if (!isObj(v)) return null;
  const { id, reference, status, party_size, starts_at, ends_at, duration_minutes, guest_name, source, is_test } = v;
  if (!isStr(id) || !UUID_RE.test(id) || !isStr(reference) || !isStr(status) || !(STATUSES as string[]).includes(status)) return null;
  if (typeof party_size !== "number" || !Number.isFinite(party_size) || typeof duration_minutes !== "number" || !Number.isFinite(duration_minutes)) return null;
  if (!isStr(starts_at) || Number.isNaN(Date.parse(starts_at)) || !isStr(ends_at) || Number.isNaN(Date.parse(ends_at))) return null;
  if (!isStr(guest_name) || !isStr(source) || typeof is_test !== "boolean") return null;
  return {
    id, reference, status: status as Status, party_size, starts_at, ends_at, duration_minutes, guest_name,
    guest_email: strOrNull(v["guest_email"]), guest_phone: strOrNull(v["guest_phone"]), notes: strOrNull(v["notes"]), source, is_test,
    consent_at: isoOrNull(v["consent_at"]), created_at: isoOrNull(v["created_at"]) ?? starts_at, updated_at: isoOrNull(v["updated_at"]) ?? starts_at,
    confirmed_at: isoOrNull(v["confirmed_at"]), cancelled_at: isoOrNull(v["cancelled_at"]), cancel_reason: strOrNull(v["cancel_reason"]),
    tables: Array.isArray(v["tables"]) ? v["tables"].filter(isStr) : [],
  };
}

// ---- which actions make sense (the server is the authority and re-checks everything) ------------------------------------------------------------

export type ActionName = "confirm" | "cancel" | "complete" | "no-show" | "reinstate";
export const ACTIONS_FOR: Record<Status, ActionName[]> = {
  pending: ["confirm", "cancel"],
  confirmed: ["complete", "no-show", "cancel"],
  cancelled: ["reinstate"],
  no_show: ["reinstate"],
  completed: [],
};
export const ACTION_LABEL: Record<ActionName, string> = { confirm: "Confirm booking", cancel: "Cancel booking", complete: "Mark completed", "no-show": "Mark no-show", reinstate: "Reinstate booking" };
export const ACTION_DONE: Record<ActionName, string> = { confirm: "Booking confirmed.", cancel: "Booking cancelled. The table is free again.", complete: "Booking marked as completed.", "no-show": "Booking marked as a no-show. The table is free again.", reinstate: "Booking reinstated." };
/** Actions that need a second click, because they release a table or are awkward to undo. */
export const NEEDS_CONFIRMATION: ReadonlySet<ActionName> = new Set<ActionName>(["cancel", "no-show"]);
export const canMove = (s: Status): boolean => s === "pending" || s === "confirmed";
export const canEdit = (s: Status): boolean => s !== "completed";

// ---- time zone conversion for the move form --------------------------------------------------------------------------------------------------

/** "2026-11-14T19:30" typed in the cafe's local time -> "2026-11-14T19:30:00+02:00". Null when it is not a real date and time. */
export function cafeLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  const t = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo! - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi) return null;
  return `${local}:00${CAFE_UTC_OFFSET}`;
}
/** An instant -> "2026-11-14T19:30" in the cafe's local time (the value of a datetime-local field). */
export function isoToCafeLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: CAFE_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

// ---- list filters -> query ---------------------------------------------------------------------------------------------------------------------

export interface ListFilters { from: string; to: string; status: Status | ""; q: string; includeTest: boolean }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
export const cleanSearch = (q: string): string => q.replace(/\s+/g, " ").trim().slice(0, 100);
export function buildListQuery(f: ListFilters, offset: number): Record<string, string | number> {
  const q: Record<string, string | number> = { include_test: f.includeTest ? "true" : "false", limit: PAGE_SIZE, offset: Math.max(0, Math.floor(offset)) };
  if (DATE_RE.test(f.from)) q["from"] = f.from;
  if (DATE_RE.test(f.to)) q["to"] = f.to;
  if (f.status !== "" && (STATUSES as string[]).includes(f.status)) q["status"] = f.status;
  const s = cleanSearch(f.q);
  if (s !== "" && !CONTROL.test(s)) q["q"] = s;
  return q;
}
/** Says what is wrong with the date range, or null when it is fine. */
export const dateRangeProblem = (from: string, to: string): string | null => (from !== "" && !DATE_RE.test(from) ? "The 'from' date is not valid." : to !== "" && !DATE_RE.test(to) ? "The 'to' date is not valid." : from !== "" && to !== "" && from > to ? "The 'from' date is after the 'to' date." : null);

// ---- edit form -> PATCH body -----------------------------------------------------------------------------------------------------------------------

export interface EditForm { name: string; email: string; phone: string; notes: string }
export type EditErrors = Partial<Record<keyof EditForm, string>>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+() -]{5,30}$/;
const NOTES_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const editFormOf = (r: ReservationFull): EditForm => ({ name: r.guest_name, email: r.guest_email ?? "", phone: r.guest_phone ?? "", notes: r.notes ?? "" });

/** Only the fields that changed are sent; a blank e-mail, phone or note means "clear it" (null). The server checks everything again. */
export function buildEditPatch(orig: ReservationFull, f: EditForm): { patch: Record<string, string | null>; errors: EditErrors } {
  const errors: EditErrors = {};
  const patch: Record<string, string | null> = {};
  const name = f.name.trim(); const email = f.email.trim(); const phone = f.phone.trim(); const notes = f.notes.trim();
  if (name === "") errors.name = "Enter the guest's name."; else if (name.length > 100) errors.name = "The name is too long (100 characters at most)."; else if (CONTROL.test(name)) errors.name = "The name has characters that are not allowed.";
  else if (name !== orig.guest_name) patch["guest_name"] = name;
  if (email !== "" && (!EMAIL_RE.test(email) || email.length > 254)) errors.email = "Enter a valid e-mail address, or leave it empty.";
  else if ((email === "" ? null : email) !== orig.guest_email) patch["guest_email"] = email === "" ? null : email;
  if (phone !== "" && !PHONE_RE.test(phone)) errors.phone = "Use 5 to 30 digits, spaces, + ( ) or -, or leave it empty.";
  else if ((phone === "" ? null : phone) !== orig.guest_phone) patch["guest_phone"] = phone === "" ? null : phone;
  if (notes.length > 500) errors.notes = "The notes are too long (500 characters at most)."; else if (NOTES_CONTROL.test(notes)) errors.notes = "The notes have characters that are not allowed.";
  else if ((notes === "" ? null : notes) !== orig.notes) patch["notes"] = notes === "" ? null : notes;
  const finalEmail = "guest_email" in patch ? patch["guest_email"] : orig.guest_email;
  const finalPhone = "guest_phone" in patch ? patch["guest_phone"] : orig.guest_phone;
  if (!errors.email && !errors.phone && finalEmail === null && finalPhone === null) errors.email = "Keep an e-mail address or a phone number so the guest can be reached.";
  return { patch, errors };
}

// ---- move form -> POST body ------------------------------------------------------------------------------------------------------------------------

export interface MoveForm { when: string; party: string; duration: string; tableId: string }
export type MoveErrors = Partial<Record<keyof MoveForm | "form", string>>;
export const moveFormOf = (r: ReservationFull): MoveForm => ({ when: isoToCafeLocal(r.starts_at), party: String(r.party_size), duration: "", tableId: "" });

/** Only what changed is sent. Time is read as the cafe's local time. A blank duration lets the owner's duration rules apply. All or nothing on the server. */
export function buildMoveBody(orig: ReservationFull, f: MoveForm): { body: Record<string, string | number>; errors: MoveErrors } {
  const errors: MoveErrors = {};
  const body: Record<string, string | number> = {};
  if (f.when !== "" && f.when !== isoToCafeLocal(orig.starts_at)) {
    const iso = cafeLocalToIso(f.when);
    if (!iso) errors.when = "Enter a valid date and time."; else body["starts_at"] = iso;
  } else if (f.when === "") errors.when = "Enter a date and time.";
  const party = f.party.trim();
  if (!/^\d{1,2}$/.test(party) || Number(party) < 1 || Number(party) > 99) errors.party = "Party size must be a whole number from 1 to 99.";
  else if (Number(party) !== orig.party_size) body["party_size"] = Number(party);
  const dur = f.duration.trim();
  if (dur !== "") {
    if (!/^\d{2,3}$/.test(dur) || Number(dur) < 15 || Number(dur) > 720) errors.duration = "Duration must be 15 to 720 minutes, or leave it empty.";
    else if (Number(dur) !== orig.duration_minutes) body["duration_minutes"] = Number(dur);
  }
  if (f.tableId !== "") { if (!UUID_RE.test(f.tableId)) errors.tableId = "Choose a table from the list."; else body["table_id"] = f.tableId; }
  if (Object.keys(errors).length === 0 && Object.keys(body).length === 0) errors.form = "Nothing has been changed.";
  return { body, errors };
}
