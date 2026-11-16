"use client";

import { useState, type FormEvent } from "react";
import { AdminApiError } from "@/lib/admin/api";
import { friendlyMessage } from "@/lib/admin/pure";
import { editReservation } from "@/lib/admin/reservation-api";
import { buildEditPatch, editFormOf, parseReservationFull, type EditErrors, type EditForm as Form, type ReservationFull } from "@/lib/admin/reservations";
import { AdminButton, Notice, TextAreaField, TextField } from "../ui";

/** Guest name, e-mail, phone and notes: nothing else. Only what changed is sent; the server checks every rule again. */
export function EditForm({ reservation, onSaved, busy, setBusy }: { reservation: ReservationFull; onSaved: (r: ReservationFull, message: string) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [f, setF] = useState<Form>(() => editFormOf(reservation));
  const [errors, setErrors] = useState<EditErrors>({});
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const { patch, errors: found } = buildEditPatch(reservation, f);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (Object.keys(patch).length === 0) { setFormError({ message: "Nothing has been changed." }); return; }
    setBusy(true);
    try {
      const r = await editReservation(reservation.id, patch);
      const next = parseReservationFull(r.reservation);
      if (!next) throw new AdminApiError(500, "internal_error");
      setF(editFormOf(next));
      onSaved(next, "Details saved.");
    } catch (e) {
      const err = e instanceof AdminApiError ? e : new AdminApiError(0, "network");
      setFormError({ message: friendlyMessage(err), requestId: err.requestId });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Edit guest details">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Guest name" name="name" autoComplete="off" maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name ?? null} />
        <TextField label="Phone" name="phone" type="tel" autoComplete="off" maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errors.phone ?? null} hint="Empty clears it." />
      </div>
      <TextField label="E-mail" name="email" type="email" autoComplete="off" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errors.email ?? null} hint="Empty clears it. One of e-mail or phone must remain." />
      <TextAreaField label="Notes" name="notes" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} error={errors.notes ?? null} hint="500 characters at most. Empty clears the note." />
      {formError ? <Notice tone="error" requestId={formError.requestId}>{formError.message}</Notice> : null}
      <AdminButton type="submit" busy={busy} className="!w-auto px-6">{busy ? "Saving…" : "Save details"}</AdminButton>
    </form>
  );
}
