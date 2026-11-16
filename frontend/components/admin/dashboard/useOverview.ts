"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGet, AdminApiError } from "@/lib/admin/api";
import {
  addDays, localDate, parseAudit, parseList, parseReadiness, parseReservation, parseTable,
  type AuditRow, type DiningTable, type Readiness, type Reservation,
} from "@/lib/admin/dashboard";

export type Part<T> = { state: "loading" } | { state: "ok"; data: T; skipped: number } | { state: "error"; error: AdminApiError };

export interface Overview {
  today: string;
  days: string[];
  /** the clock reading taken when this data was loaded (render code never reads the clock itself) */
  now: number;
  loadedAt: number | null;
  week: Part<Reservation[]>;
  pending: Part<Reservation[]>;
  readiness: Part<Readiness | null>;
  tables: Part<DiningTable[]>;
  audit: Part<AuditRow[]>;
  /** true when a list was cut off at the page limit, so a count shown is "at least" */
  truncated: { week: boolean; pending: boolean };
}

const LOADING: Part<never> = { state: "loading" };
const initial = (today: string, now: number): Overview => ({ today, now, days: Array.from({ length: 7 }, (_, i) => addDays(today, i)), loadedAt: null, week: LOADING, pending: LOADING, readiness: LOADING, tables: LOADING, audit: LOADING, truncated: { week: false, pending: false } });

const asError = (e: unknown): AdminApiError => (e instanceof AdminApiError ? e : new AdminApiError(0, "network"));
async function part<R, T>(call: Promise<R>, pick: (r: R) => { data: T; skipped: number }): Promise<Part<T>> {
  try { const r = pick(await call); return { state: "ok", ...r }; }
  catch (e) { if (e instanceof DOMException && e.name === "AbortError") throw e; return { state: "error", error: asError(e) }; }
}

/**
 * Loads the overview from the OWNER API only (GET requests, one per card, so one failure never blanks the screen).
 * Test bookings are always requested and filtered on screen, so the page can say how many are hidden.
 * There is deliberately NO timer: automatic polling would keep the session alive for ever and defeat the 30-minute idle timeout.
 */
export function useOverview(): { data: Overview; refresh: () => void; refreshing: boolean } {
  const [data, setData] = useState<Overview>(() => { const now = Date.now(); return initial(localDate(now), now); });
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    const ctl = new AbortController();
    const loadedNow = Date.now();
    const today = localDate(loadedNow);
    const to = addDays(today, 6);
    const sig = ctl.signal;
    const week = adminGet<{ items: unknown[]; has_more: boolean }>("/reservations", { from: today, to, include_test: true, limit: 100 }, sig);
    const pending = adminGet<{ items: unknown[]; has_more: boolean }>("/reservations", { from: today, status: "pending", include_test: true, limit: 100 }, sig);
    const readiness = adminGet<{ item: unknown }>("/readiness", {}, sig);
    const tables = adminGet<{ items: unknown[] }>("/tables", {}, sig);
    const audit = adminGet<{ items: unknown[] }>("/audit-log", { limit: 50 }, sig);
    const trunc = { week: false, pending: false };
    Promise.all([
      part(week, (r) => { trunc.week = r.has_more === true; const p = parseList(r.items, parseReservation); return { data: p.rows, skipped: p.skipped }; }),
      part(pending, (r) => { trunc.pending = r.has_more === true; const p = parseList(r.items, parseReservation); return { data: p.rows, skipped: p.skipped }; }),
      part(readiness, (r) => ({ data: parseReadiness(r.item), skipped: r.item !== null && parseReadiness(r.item) === null ? 1 : 0 })),
      part(tables, (r) => { const p = parseList(r.items, parseTable); return { data: p.rows, skipped: p.skipped }; }),
      part(audit, (r) => { const p = parseList(r.items, parseAudit); return { data: p.rows, skipped: p.skipped }; }),
    ]).then(([w, p, r, t, a]) => {
      setData({ today, now: loadedNow, days: Array.from({ length: 7 }, (_, i) => addDays(today, i)), loadedAt: Date.now(), week: w, pending: p, readiness: r, tables: t, audit: a, truncated: trunc });
      setRefreshing(false);
    }, () => { /* aborted: the screen is going away or a newer load replaced this one */ });
    return () => ctl.abort();
  }, [tick]);

  const refresh = useCallback(() => { setRefreshing(true); setTick((n) => n + 1); }, []);
  return { data, refresh, refreshing };
}
