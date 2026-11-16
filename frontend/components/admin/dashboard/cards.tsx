import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { friendlyMessage } from "@/lib/admin/pure";
import {
  describeActivity, formatDay, formatTime, readinessChecklist, relativeTime, securitySummary, SOURCE_LABEL, shortName, STATUS_LABEL, tableStats,
  type AuditRow, type DaySummary, type DiningTable, type Readiness, type Reservation, type Tone,
} from "@/lib/admin/dashboard";
import { Notice } from "../ui";
import type { Part } from "./useOverview";

/** One card of the overview. Shows its own loading and error state, so one failing request never blanks the others. */
export function Card({ id, title, part, className, children, empty }: { id: string; title: string; part: Part<unknown>; className?: string; children: ReactNode; empty?: boolean }) {
  return (
    <section aria-labelledby={`${id}-h`} data-testid={`card-${id}`} className={cn("rounded-2xl border border-line bg-onyx p-6", className)}>
      <h2 id={`${id}-h`} className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">{title}</h2>
      <div className="mt-4">
        {part.state === "loading" ? <p role="status" className="text-sm text-mist">Loading…</p>
          : part.state === "error" ? <Notice tone="error" requestId={part.error.requestId}>This could not be loaded. {friendlyMessage(part.error)}</Notice>
          : empty ? <p className="text-sm text-mist">Nothing to show.</p>
          : children}
      </div>
    </section>
  );
}

const TONE: Record<Tone, string> = { normal: "text-bone", good: "text-ok", warn: "text-gold-light", bad: "text-danger" };

export function Big({ value, label, testId }: { value: ReactNode; label: string; testId?: string }) {
  return (
    <div>
      <p className="font-display text-5xl leading-none text-bone" data-testid={testId}>{value}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-mist">{label}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: Reservation["status"] }) {
  const tone = status === "confirmed" ? "border-ok/40 text-ok" : status === "pending" ? "border-gold/50 text-gold-light" : status === "completed" ? "border-line text-mist" : "border-danger/40 text-danger";
  return <span className={cn("rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em]", tone)}>{STATUS_LABEL[status]}</span>;
}
const TestTag = () => <span title="Fake or test booking" className="rounded-full border border-line px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-mist">Test</span>;

// ---- today --------------------------------------------------------------------------------------------------------------------------------------
export function TodayCard({ part, summary, rows }: { part: Part<Reservation[]>; summary: DaySummary | null; rows: Reservation[] }) {
  return (
    <Card id="today" title="Today" part={part}>
      {summary ? (
        <div className="space-y-4">
          <div className="flex gap-8">
            <Big value={summary.bookings} label={summary.bookings === 1 ? "Booking" : "Bookings"} testId="today-bookings" />
            <Big value={summary.guests} label="Guests" testId="today-guests" />
          </div>
          <p className="text-sm text-mist">
            {summary.confirmed} confirmed · {summary.pending} pending
            {summary.next ? <> · next at <strong className="text-bone">{formatTime(summary.next.starts_at)}</strong></> : rows.length > 0 ? " · no more arrivals today" : ""}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

// ---- next 7 days -------------------------------------------------------------------------------------------------------------------------------------
export function WeekCard({ part, days, truncated }: { part: Part<Reservation[]>; days: DaySummary[]; truncated: boolean }) {
  const bookings = days.reduce((n, d) => n + d.bookings, 0);
  const guests = days.reduce((n, d) => n + d.guests, 0);
  const max = Math.max(1, ...days.map((d) => d.bookings));
  return (
    <Card id="week" title="Next 7 days" part={part}>
      <div className="space-y-4">
        <div className="flex gap-8">
          <Big value={`${truncated ? "100+" : bookings}`} label="Bookings" testId="week-bookings" />
          <Big value={truncated ? "—" : guests} label="Guests" testId="week-guests" />
        </div>
        <ul className="space-y-1.5" aria-label="Bookings per day">
          {days.map((d) => (
            <li key={d.date} className="flex items-center gap-3 text-xs text-mist">
              <span className="w-20 shrink-0">{formatDay(d.date)}</span>
              <span className="h-1.5 flex-1 rounded-full bg-smoke" aria-hidden><span className="block h-full rounded-full bg-gold" style={{ width: `${Math.round((d.bookings / max) * 100)}%` }} /></span>
              <span className="w-14 shrink-0 text-right text-bone">{d.bookings} · {d.guests}p</span>
            </li>
          ))}
        </ul>
        <p className="text-[0.7rem] text-mist">Each row: bookings · guests (p). Cancelled and no-show bookings are not counted.</p>
      </div>
    </Card>
  );
}

// ---- needs attention ---------------------------------------------------------------------------------------------------------------------------------
export function AttentionCard({ part, rows, truncated }: { part: Part<Reservation[]>; rows: Reservation[]; truncated: boolean }) {
  return (
    <Card id="attention" title="Needs your attention" part={part}>
      <Big value={`${rows.length}${truncated ? "+" : ""}`} label={rows.length === 1 ? "Pending booking" : "Pending bookings"} testId="pending-count" />
      {rows.length === 0 ? <p className="mt-4 text-sm text-ok">All caught up: nothing is waiting for confirmation.</p> : (
        <ul className="mt-4 space-y-2 text-sm" aria-label="Soonest pending bookings">
          {rows.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="text-bone">{shortName(r.guest_name)} <span className="text-mist">· {r.party_size}p</span></span>
              <span className="text-xs text-mist">{formatDay(r.starts_at.slice(0, 10))} {formatTime(r.starts_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 5 ? <p className="mt-3 text-xs text-mist">+ {rows.length - 5} more</p> : null}
    </Card>
  );
}

// ---- readiness ----------------------------------------------------------------------------------------------------------------------------------------
export function ReadinessCard({ part, readiness }: { part: Part<Readiness | null>; readiness: Readiness | null }) {
  const view = readiness ? readinessChecklist(readiness) : null;
  return (
    <Card id="readiness" title="Booking readiness" part={part} empty={part.state === "ok" && !readiness}>
      {view ? (
        <div className="space-y-3">
          <p className={cn("text-lg", view.ready ? "text-ok" : "text-gold-light")} data-testid="readiness-status">{view.ready ? "Ready for online booking requests" : "Not ready for online booking yet"}</p>
          <ul className="space-y-1 text-sm">
            {view.items.map((i) => <li key={i.label} className={i.ok ? "text-mist" : "text-gold-light"}><span aria-hidden>{i.ok ? "✓" : "✗"}</span> <span className="sr-only">{i.ok ? "Done: " : "Missing: "}</span>{i.label}</li>)}
          </ul>
          <p className="text-xs text-mist">Bookings are confirmed {view.autoConfirm ? "automatically" : "by you"}.</p>
        </div>
      ) : null}
    </Card>
  );
}

// ---- today's list --------------------------------------------------------------------------------------------------------------------------------------
export function TodayListCard({ part, rows }: { part: Part<Reservation[]>; rows: Reservation[] }) {
  return (
    <Card id="today-list" title="Today's bookings" part={part} className="lg:col-span-2" empty={part.state === "ok" && rows.length === 0}>
      <ol className="divide-y divide-line text-sm" aria-label="Today's bookings in time order">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[4rem_1fr_5rem_8rem_auto]">
            <span className="font-semibold text-bone">{formatTime(r.starts_at)}</span>
            <span className="truncate text-bone">{shortName(r.guest_name)} {r.is_test ? <TestTag /> : null}</span>
            <span className="hidden text-mist sm:block">{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</span>
            <span className="hidden text-xs text-mist sm:block">{r.tables.length ? r.tables.join(", ") : "No table"} · {SOURCE_LABEL[r.source] ?? r.source}</span>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---- tables ---------------------------------------------------------------------------------------------------------------------------------------------
export function TablesCard({ part, tables }: { part: Part<DiningTable[]>; tables: DiningTable[] }) {
  const s = tableStats(tables);
  return (
    <Card id="tables" title="Tables" part={part} empty={part.state === "ok" && tables.length === 0}>
      <div className="space-y-3">
        <div className="flex gap-8"><Big value={s.active} label="Active" testId="tables-active" /><Big value={s.online} label="Online-bookable" /></div>
        <p className="text-sm text-mist">Up to {s.seats} seats. {s.sections.map((x) => `${x.name} ${x.count}`).join(" · ")}</p>
      </div>
    </Card>
  );
}

// ---- recent activity and sign-in security -------------------------------------------------------------------------------------------------
export function ActivityCard({ part, rows, now }: { part: Part<AuditRow[]>; rows: AuditRow[]; now: number }) {
  return (
    <Card id="activity" title="Recent activity" part={part} className="lg:col-span-2" empty={part.state === "ok" && rows.length === 0}>
      <ul className="divide-y divide-line text-sm" aria-label="Latest events">
        {rows.slice(0, 8).map((r) => {
          const a = describeActivity(r);
          return (
            <li key={r.id} className="flex items-baseline justify-between gap-4 py-2.5">
              <span className={TONE[a.tone]}>{a.text}{r.actor_email ? <span className="text-mist"> · {r.actor_email}</span> : null}</span>
              <time dateTime={r.at} className="shrink-0 text-xs text-mist">{relativeTime(r.at, now)}</time>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function SecurityCard({ part, rows, now }: { part: Part<AuditRow[]>; rows: AuditRow[]; now: number }) {
  const s = securitySummary(rows, now);
  const calm = s.failedSignIns === 0 && s.lockouts === 0;
  return (
    <Card id="security" title="Sign-in security" part={part}>
      <div className="space-y-3">
        <p className={cn("text-lg", calm ? "text-ok" : "text-gold-light")} data-testid="security-status">{calm ? "No failed sign-ins in the last 24 hours" : `${s.failedSignIns} failed sign-in${s.failedSignIns === 1 ? "" : "s"} in the last 24 hours`}</p>
        <ul className="space-y-1 text-sm text-mist">
          <li>Account lock-outs: <span className="text-bone">{s.lockouts}</span></li>
        </ul>
        <p className="text-[0.7rem] text-mist">Based on the latest {s.window} events.</p>
      </div>
    </Card>
  );
}
