"use client";

// The reservation list's filters, kept in memory only (a module variable read with useSyncExternalStore) so they survive opening a booking and
// coming back. Nothing is written to the URL, localStorage, sessionStorage or cookies: a search for a guest's name, e-mail or phone number must
// not end up in history, bookmarks or logs.
import { useSyncExternalStore } from "react";
import { addDays, localDate } from "./dashboard";
import type { ListFilters } from "./reservations";

export interface FilterState extends ListFilters { offset: number }
const SERVER: FilterState = { from: "", to: "", status: "", q: "", includeTest: false, offset: 0 };
let state: FilterState | null = null;
const listeners = new Set<() => void>();

function current(): FilterState {
  if (!state) { const today = localDate(Date.now()); state = { from: today, to: addDays(today, 13), status: "", q: "", includeTest: false, offset: 0 }; }
  return state;
}
const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Changing any filter goes back to the first page; changing only the page keeps the filters. */
export function setFilters(change: Partial<FilterState>): void {
  const next = { ...current(), ...change };
  if (!("offset" in change)) next.offset = 0;
  state = next;
  listeners.forEach((fn) => fn());
}
export const useFilters = (): FilterState => useSyncExternalStore(subscribe, current, () => SERVER);
