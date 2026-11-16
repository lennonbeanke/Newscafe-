"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/admin/api";
import { friendlyMessage } from "@/lib/admin/pure";
import { runAction } from "@/lib/admin/reservation-api";
import { ACTION_DONE, ACTION_LABEL, ACTIONS_FOR, NEEDS_CONFIRMATION, parseReservationFull, type ActionName, type ReservationFull } from "@/lib/admin/reservations";
import { AdminButton, Notice, TextAreaField } from "../ui";

/** The status changes that make sense for this booking. Cancel and no-show release the table, so they need a second, deliberate click. */
export function ActionPanel({ reservation, onChanged, busy, setBusy }: { reservation: ReservationFull; onChanged: (r: ReservationFull, message: string) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const actions = ACTIONS_FOR[reservation.status];

  const perform = async (action: ActionName) => {
    setBusy(true); setError(null);
    try {
      const r = await runAction(reservation.id, action, action === "cancel" ? reason.trim() : undefined);
      const next = parseReservationFull(r.reservation);
      if (!next) throw new AdminApiError(500, "internal_error");
      setPendingAction(null); setReason("");
      onChanged(next, ACTION_DONE[action]);
    } catch (e) {
      const err = e instanceof AdminApiError ? e : new AdminApiError(0, "network");
      setError({ message: friendlyMessage(err), requestId: err.requestId });
      setPendingAction(null);
    } finally { setBusy(false); }
  };

  const click = (a: ActionName) => { setError(null); if (NEEDS_CONFIRMATION.has(a)) setPendingAction(a); else void perform(a); };

  if (actions.length === 0) return <p className="text-sm text-mist">This booking is finished; no status changes are available.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {actions.map((a) => (
          <AdminButton key={a} variant={a === "cancel" || a === "no-show" ? "secondary" : "primary"} className={a === "confirm" || a === "complete" || a === "reinstate" ? "!w-auto px-6" : ""} disabled={busy || pendingAction !== null} onClick={() => click(a)}>{ACTION_LABEL[a]}</AdminButton>
        ))}
      </div>
      {pendingAction ? (
        <div role="group" aria-label="Please confirm" className="space-y-3 rounded-lg border border-gold/40 bg-gold/5 p-4">
          <p className="text-sm text-bone">{pendingAction === "cancel" ? "Cancel this booking? The table becomes free for other guests." : "Mark this guest as a no-show? The table becomes free again."}</p>
          {pendingAction === "cancel" ? <TextAreaField label="Reason (optional)" name="reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} hint="Kept in the booking's history. 300 characters at most." /> : null}
          <div className="flex flex-wrap gap-3">
            <AdminButton className="!w-auto px-6" busy={busy} onClick={() => void perform(pendingAction)}>{pendingAction === "cancel" ? "Yes, cancel the booking" : "Yes, mark as no-show"}</AdminButton>
            <AdminButton variant="secondary" disabled={busy} onClick={() => { setPendingAction(null); setReason(""); }}>Keep the booking</AdminButton>
          </div>
        </div>
      ) : null}
      {error ? <Notice tone="error" requestId={error.requestId}>{error.message}</Notice> : null}
    </div>
  );
}
