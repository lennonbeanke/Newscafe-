"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AdminApiError } from "@/lib/admin/api";
import { formatDay, formatTime, localDate } from "@/lib/admin/dashboard";
import { friendlyMessage } from "@/lib/admin/pure";
import { getReservation } from "@/lib/admin/reservation-api";
import { canEdit, canMove, parseReservationFull, SOURCE_TEXT, UUID_RE, type ReservationFull } from "@/lib/admin/reservations";
import { StatusBadge } from "../dashboard/cards";
import { AdminButton, Notice } from "../ui";
import { ActionPanel } from "./ActionPanel";
import { EditForm } from "./EditForm";
import { MoveForm } from "./MoveForm";

type Load = { id: string; tick: number; result: { status: "ok"; reservation: ReservationFull } | { status: "error"; error: AdminApiError } | { status: "bad" } };

const when = (iso: string): string => `${formatDay(localDate(Date.parse(iso)))}, ${formatTime(iso)}`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-[0.16em] text-mist">{label}</dt><dd className="mt-1 text-sm text-bone">{children}</dd></div>;
}
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-line bg-onyx p-6">
      <h2 id={`${id}-h`} className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One booking: everything about it, the status changes that apply, and the forms to edit the guest's details or move it. */
export function ReservationDetail({ id }: { id: string }) {
  const valid = UUID_RE.test(id);
  const [tick, setTick] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<"edit" | "move" | null>(null);

  useEffect(() => {
    if (!valid) return;
    const ctl = new AbortController();
    getReservation(id, ctl.signal).then(
      (r) => { const p = parseReservationFull(r.reservation); setLoad({ id, tick, result: p ? { status: "ok", reservation: p } : { status: "error", error: new AdminApiError(500, "internal_error") } }); },
      (e) => { if (e instanceof DOMException && e.name === "AbortError") return; setLoad({ id, tick, result: { status: "error", error: e instanceof AdminApiError ? e : new AdminApiError(0, "network") } }); },
    );
    return () => ctl.abort();
  }, [id, tick, valid]);

  const current = load && load.id === id && load.tick === tick ? load.result : null;
  const changed = (r: ReservationFull, text: string) => { setLoad({ id, tick, result: { status: "ok", reservation: r } }); setMessage(text); setOpen(null); };
  const back = <Link href="/admin/reservations" className="text-sm text-gold underline-offset-4 hover:underline">← All reservations</Link>;

  if (!valid) return <div className="space-y-4">{back}<Notice tone="error">That is not a valid booking link.</Notice></div>;
  if (!current) return <div className="space-y-4">{back}<p role="status" className="text-sm text-mist">Loading the booking…</p></div>;
  if (current.status === "error") {
    return (
      <div className="space-y-4">{back}
        <Notice tone="error" requestId={current.error.requestId}>{friendlyMessage(current.error)}</Notice>
        {current.error.status !== 404 ? <AdminButton variant="secondary" onClick={() => setTick((n) => n + 1)}>Try again</AdminButton> : null}
      </div>
    );
  }
  if (current.status !== "ok") return null;
  const r = current.reservation;

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-bone" data-testid="guest-name">{r.guest_name}</h1>
          <p className="mt-1 text-sm text-mist">Reference <span className="text-bone" data-testid="reference">{r.reference}</span> · {SOURCE_TEXT[r.source] ?? r.source}{r.is_test ? " · test booking" : ""}</p>
        </div>
        <div data-testid="status"><StatusBadge status={r.status} /></div>
      </div>

      {message ? <div aria-live="polite"><Notice tone="info">{message}</Notice></div> : null}

      <Section id="details" title="Booking">
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="When"><span data-testid="when">{when(r.starts_at)}</span> <span className="text-mist">for {r.duration_minutes} min</span></Field>
          <Field label="Party size">{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</Field>
          <Field label="Table">{r.tables.length ? r.tables.join(", ") : <span className="text-mist">None</span>}</Field>
          <Field label="Phone">{r.guest_phone ?? <span className="text-mist">Not given</span>}</Field>
          <Field label="E-mail">{r.guest_email ?? <span className="text-mist">Not given</span>}</Field>
          <Field label="Notes">{r.notes ?? <span className="text-mist">None</span>}</Field>
          <Field label="Requested">{when(r.created_at)}</Field>
          <Field label="Confirmed">{r.confirmed_at ? when(r.confirmed_at) : <span className="text-mist">Not yet</span>}</Field>
          {r.cancelled_at ? <Field label="Cancelled">{when(r.cancelled_at)}{r.cancel_reason ? <span className="block text-mist">Reason: {r.cancel_reason}</span> : null}</Field> : null}
        </dl>
      </Section>

      <Section id="actions" title="What would you like to do?"><ActionPanel key={`${r.id}-${r.status}`} reservation={r} onChanged={changed} busy={busy} setBusy={setBusy} /></Section>

      {canEdit(r.status) || canMove(r.status) ? (
        <Section id="change" title="Change this booking">
          <div className="flex flex-wrap gap-3">
            {canEdit(r.status) ? <AdminButton variant="secondary" aria-expanded={open === "edit"} onClick={() => setOpen(open === "edit" ? null : "edit")}>{open === "edit" ? "Close" : "Edit guest details"}</AdminButton> : null}
            {canMove(r.status) ? <AdminButton variant="secondary" aria-expanded={open === "move"} onClick={() => setOpen(open === "move" ? null : "move")}>{open === "move" ? "Close" : "Move or change time, party, table"}</AdminButton> : null}
          </div>
          {open === "edit" ? <div className="mt-6"><EditForm key={r.updated_at} reservation={r} onSaved={changed} busy={busy} setBusy={setBusy} /></div> : null}
          {open === "move" ? <div className="mt-6"><MoveForm key={r.updated_at} reservation={r} onMoved={changed} busy={busy} setBusy={setBusy} /></div> : null}
        </Section>
      ) : null}
    </div>
  );
}
