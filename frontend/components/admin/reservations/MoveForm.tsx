"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AdminApiError } from "@/lib/admin/api";
import { parseList, parseTable, type DiningTable } from "@/lib/admin/dashboard";
import { friendlyMessage } from "@/lib/admin/pure";
import { listTables, moveReservation } from "@/lib/admin/reservation-api";
import { buildMoveBody, moveFormOf, parseReservationFull, type MoveErrors, type MoveForm as Form, type ReservationFull } from "@/lib/admin/reservations";
import { AdminButton, Notice, SelectField, TextField } from "../ui";

/** Change the time, party size, length of stay and/or table. All or nothing: if the new slot is not free, the booking stays exactly as it was. */
export function MoveForm({ reservation, onMoved, busy, setBusy }: { reservation: ReservationFull; onMoved: (r: ReservationFull, message: string) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [f, setF] = useState<Form>(() => moveFormOf(reservation));
  const [errors, setErrors] = useState<MoveErrors>({});
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);
  const [tables, setTables] = useState<DiningTable[] | "error" | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listTables(ctl.signal).then(
      (r) => setTables(parseList(r.items, parseTable).rows.filter((t) => t.is_active)),
      (e) => { if (!(e instanceof DOMException && e.name === "AbortError")) setTables("error"); },
    );
    return () => ctl.abort();
  }, []);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const { body, errors: found } = buildMoveBody(reservation, f);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const r = await moveReservation(reservation.id, body);
      const next = parseReservationFull(r.reservation);
      if (!next) throw new AdminApiError(500, "internal_error");
      setF(moveFormOf(next));
      onMoved(next, "Booking updated.");
    } catch (e) {
      const err = e instanceof AdminApiError ? e : new AdminApiError(0, "network");
      setFormError({ message: friendlyMessage(err), requestId: err.requestId });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Move or change this booking">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date and time" name="when" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} error={errors.when ?? null} hint="In the cafe's local time. Pick a time on the booking grid." />
        <TextField label="Party size" name="party" inputMode="numeric" maxLength={2} value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} error={errors.party ?? null} />
        <TextField label="Length of stay (minutes)" name="duration" inputMode="numeric" maxLength={3} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} error={errors.duration ?? null} hint={`Now ${reservation.duration_minutes}. Leave empty to keep it, or to apply your dining-time rules after a party-size change.`} />
        <SelectField label="Table" name="table" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })} error={errors.tableId ?? null} disabled={tables === null || tables === "error"}
          hint={tables === "error" ? "The table list could not be loaded; the system will choose a table." : tables === null ? "Loading tables…" : `Now: ${reservation.tables.join(", ") || "none"}. Automatic lets the system pick a free table.`}>
          <option value="">Automatic</option>
          {Array.isArray(tables) ? tables.map((t) => <option key={t.id} value={t.id}>{t.label}{t.section ? ` · ${t.section}` : ""} · seats {t.min_covers}–{t.max_covers}</option>) : null}
        </SelectField>
      </div>
      {errors.form ? <Notice tone="info">{errors.form}</Notice> : null}
      {formError ? <Notice tone="error" requestId={formError.requestId}>{formError.message}</Notice> : null}
      <AdminButton type="submit" busy={busy} className="!w-auto px-6">{busy ? "Saving…" : "Save changes"}</AdminButton>
    </form>
  );
}
