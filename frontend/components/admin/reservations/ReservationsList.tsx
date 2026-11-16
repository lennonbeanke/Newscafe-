"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AdminApiError } from "@/lib/admin/api";
import { formatDay, formatTime, localDate, parseList } from "@/lib/admin/dashboard";
import { setFilters, useFilters } from "@/lib/admin/filters";
import { friendlyMessage } from "@/lib/admin/pure";
import { listReservations } from "@/lib/admin/reservation-api";
import { buildListQuery, cleanSearch, dateRangeProblem, PAGE_SIZE, parseReservationFull, SOURCE_TEXT, STATUS_TEXT, STATUSES, type ReservationFull, type Status } from "@/lib/admin/reservations";
import { StatusBadge } from "../dashboard/cards";
import { AdminButton, Notice, SelectField, TextField } from "../ui";

type Result = { status: "ok"; rows: ReservationFull[]; hasMore: boolean; skipped: number } | { status: "error"; error: AdminApiError };

/** Search and filter every booking. Read-only here; opening a booking is where changes are made. Filters live in memory only (see lib/admin/filters.ts). */
export function ReservationsList() {
  const f = useFilters();
  const [draftQ, setDraftQ] = useState(f.q);
  const [tick, setTick] = useState(0);
  const [load, setLoad] = useState<{ key: string; result: Result } | null>(null);
  const problem = dateRangeProblem(f.from, f.to);
  const query = buildListQuery(f, f.offset);
  const key = `${tick}|${JSON.stringify(query)}`;

  useEffect(() => {
    if (problem) return;
    const ctl = new AbortController();
    listReservations(query, ctl.signal).then(
      (r) => { const p = parseList(r.items, parseReservationFull); setLoad({ key, result: { status: "ok", rows: p.rows, hasMore: r.has_more === true, skipped: p.skipped } }); },
      (e) => { if (e instanceof DOMException && e.name === "AbortError") return; setLoad({ key, result: { status: "error", error: e instanceof AdminApiError ? e : new AdminApiError(0, "network") } }); },
    );
    return () => ctl.abort();
    // `query` is rebuilt from the filters on every render; `key` is its stable form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, problem]);

  const loading = !problem && load?.key !== key;
  const result = !problem && load?.key === key ? load.result : null;
  const applySearch = (ev: FormEvent) => { ev.preventDefault(); setFilters({ q: cleanSearch(draftQ) }); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-bone">Reservations</h1>
        <p className="mt-1 text-sm text-mist">Find a booking, then open it to confirm, cancel, edit or move it.</p>
      </div>

      <form onSubmit={applySearch} className="grid gap-4 rounded-2xl border border-line bg-onyx p-5 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter reservations">
        <div className="lg:col-span-2"><TextField label="Search" name="q" type="search" autoComplete="off" spellCheck={false} maxLength={100} value={draftQ} onChange={(e) => setDraftQ(e.target.value)} hint="Name, e-mail, phone or reference. Press Enter to search." /></div>
        <TextField label="From" name="from" type="date" value={f.from} onChange={(e) => setFilters({ from: e.target.value })} />
        <TextField label="To" name="to" type="date" value={f.to} onChange={(e) => setFilters({ to: e.target.value })} />
        <SelectField label="Status" name="status" value={f.status} onChange={(e) => setFilters({ status: e.target.value as Status | "" })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
        </SelectField>
        <div className="flex flex-col justify-end gap-3">
          <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" checked={f.includeTest} onChange={(e) => setFilters({ includeTest: e.target.checked })} className="h-4 w-4 accent-[#c9a45c]" />Include test bookings</label>
          <div className="flex gap-2">
            <AdminButton type="submit" variant="secondary" className="!px-4 !py-2">Search</AdminButton>
            <AdminButton variant="link" onClick={() => { setDraftQ(""); setFilters({ q: "", from: localDate(Date.now()), to: "", status: "", includeTest: false }); }}>Reset</AdminButton>
          </div>
        </div>
      </form>

      {problem ? <Notice tone="warning">{problem}</Notice> : null}
      {!f.includeTest ? <p className="text-xs text-mist">Test bookings are hidden. Tick “Include test bookings” to see them.</p> : null}

      <section aria-labelledby="results-h" data-testid="results" className="rounded-2xl border border-line bg-onyx p-2 sm:p-4">
        <h2 id="results-h" className="sr-only">Matching bookings</h2>
        {loading ? <p role="status" className="p-4 text-sm text-mist">Loading…</p>
          : result?.status === "error" ? (
            <div className="space-y-3 p-4">
              <Notice tone="error" requestId={result.error.requestId}>The bookings could not be loaded. {friendlyMessage(result.error)}</Notice>
              <AdminButton variant="secondary" onClick={() => setTick((n) => n + 1)}>Try again</AdminButton>
            </div>
          ) : result?.status === "ok" ? (
            <>
              {result.skipped > 0 ? <div className="p-2"><Notice tone="warning">{result.skipped} {result.skipped === 1 ? "booking" : "bookings"} from the server could not be read and {result.skipped === 1 ? "was" : "were"} left out.</Notice></div> : null}
              {result.rows.length === 0 ? <p className="p-4 text-sm text-mist" data-testid="empty">No bookings match. Try a wider date range, another status, or include test bookings.</p> : (
                <ol className="divide-y divide-line" aria-label="Bookings">
                  {result.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/admin/reservations/${r.id}`} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-3 text-sm hover:bg-smoke/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 sm:grid-cols-[8rem_1fr_5rem_9rem_auto]">
                        <span><span className="block text-bone">{formatDay(localDate(Date.parse(r.starts_at)))}</span><span className="text-xs text-mist">{formatTime(r.starts_at)}</span></span>
                        <span className="min-w-0"><span className="block truncate text-bone">{r.guest_name}{r.is_test ? <span title="Fake or test booking" className="ml-2 rounded-full border border-line px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-mist">Test</span> : null}</span><span className="text-xs text-mist">Ref {r.reference}</span></span>
                        <span className="hidden text-mist sm:block">{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</span>
                        <span className="hidden text-xs text-mist sm:block">{r.tables.length ? r.tables.join(", ") : "No table"} · {SOURCE_TEXT[r.source] ?? r.source}</span>
                        <StatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
              <nav aria-label="Pages" className="flex items-center justify-between gap-4 p-3 text-sm text-mist">
                <span data-testid="range">{result.rows.length === 0 ? "" : `Showing ${f.offset + 1}–${f.offset + result.rows.length}`}</span>
                <span className="flex gap-2">
                  <AdminButton variant="secondary" className="!px-4 !py-2" disabled={f.offset === 0} onClick={() => setFilters({ offset: Math.max(0, f.offset - PAGE_SIZE) })}>Previous</AdminButton>
                  <AdminButton variant="secondary" className="!px-4 !py-2" disabled={!result.hasMore} onClick={() => setFilters({ offset: f.offset + PAGE_SIZE })}>Next</AdminButton>
                </span>
              </nav>
            </>
          ) : null}
      </section>
    </div>
  );
}
