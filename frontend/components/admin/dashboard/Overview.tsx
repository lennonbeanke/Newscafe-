"use client";

import { useMemo, useState } from "react";
import { forDate, formatDay, splitTest, summarizeDays, type Reservation } from "@/lib/admin/dashboard";
import { AdminButton, Notice } from "../ui";
import { ActivityCard, AttentionCard, ReadinessCard, SecurityCard, TablesCard, TodayCard, TodayListCard, WeekCard } from "./cards";
import { useOverview } from "./useOverview";

const EMPTY: Reservation[] = [];

/** The owner's landing page after sign-in: what is happening today, what needs a decision, and whether anything looks wrong. Read-only. */
export function Overview() {
  const { data, refresh, refreshing } = useOverview();
  const [includeTest, setIncludeTest] = useState(false);
  const now = data.now;

  const week = data.week.state === "ok" ? data.week.data : EMPTY;
  const pending = data.pending.state === "ok" ? data.pending.data : EMPTY;
  const { shown: weekShown } = useMemo(() => splitTest(week, includeTest), [week, includeTest]);
  const { shown: pendingShown } = useMemo(() => splitTest(pending, includeTest), [pending, includeTest]);
  const days = useMemo(() => summarizeDays(weekShown, data.days, now), [weekShown, data.days, now]);
  const today = days[0] ?? null;
  const todayRows = useMemo(() => forDate(weekShown, data.today).filter((r) => r.status !== "cancelled" && r.status !== "no_show"), [weekShown, data.today]);
  // the same test booking can be in both lists: count each once
  const hidden = useMemo(() => new Set([...week, ...pending].filter((r) => r.is_test).map((r) => r.id)).size, [week, pending]);
  const skipped = [data.week, data.pending, data.tables, data.audit].reduce((n, p) => n + (p.state === "ok" ? p.skipped : 0), 0);
  const audit = data.audit.state === "ok" ? data.audit.data : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-bone">Overview</h1>
          <p className="mt-1 text-sm text-mist" data-testid="today-date">{formatDay(data.today)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-mist">
            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} className="h-4 w-4 accent-[#c9a45c]" />
            Include test bookings
          </label>
          <AdminButton variant="secondary" busy={refreshing} onClick={refresh} className="!px-4 !py-2">{refreshing ? "Refreshing…" : "Refresh"}</AdminButton>
        </div>
      </div>
      <p className="text-xs text-mist" aria-live="polite" data-testid="updated">
                {data.loadedAt ? `Updated ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(data.loadedAt)}. ` : ""}
        The overview does not refresh by itself, so your session can time out when you are away.
      </p>

      {!includeTest && hidden > 0 ? <Notice tone="info">{hidden} test {hidden === 1 ? "booking is" : "bookings are"} hidden. Tick “Include test bookings” to see {hidden === 1 ? "it" : "them"}.</Notice> : null}
      {data.truncated.week || data.truncated.pending ? <Notice tone="warning">There are more than 100 bookings in this view, so some totals show “100+”.</Notice> : null}
      {skipped > 0 ? <Notice tone="warning">{skipped} {skipped === 1 ? "item" : "items"} from the server could not be read and {skipped === 1 ? "was" : "were"} left out.</Notice> : null}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <TodayCard part={data.week} summary={today} rows={todayRows} />
        <WeekCard part={data.week} days={days} truncated={data.truncated.week} />
        <AttentionCard part={data.pending} rows={pendingShown} truncated={data.truncated.pending} />
        <ReadinessCard part={data.readiness} readiness={data.readiness.state === "ok" ? data.readiness.data : null} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <TodayListCard part={data.week} rows={todayRows} />
        <TablesCard part={data.tables} tables={data.tables.state === "ok" ? data.tables.data : []} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <ActivityCard part={data.audit} rows={audit} now={now} />
        <SecurityCard part={data.audit} rows={audit} now={now} />
      </div>
    </div>
  );
}
