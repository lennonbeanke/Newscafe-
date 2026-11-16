"use client";

// Session state for the owner area. The truth lives on the server (HttpOnly cookie + database row); this only mirrors it in memory so the
// screens know what to show. Protecting a screen here is a convenience: the owner API refuses every request without a valid session.
//
// Why the check is made in the browser and not in a Next.js proxy: the API's session cookie is scoped to Path=/api/admin (a deliberate
// hardening), so the browser does not send it with page requests for /admin/*. Pages contain no owner data; everything private is fetched
// from the API, which answers 401 without a session.
//
// The state is a tiny in-memory store (no storage of any kind), read with useSyncExternalStore.
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import * as api from "./api";
import { AdminApiError, onSessionLost, setCsrfToken, type AdminUser, type SignedIn } from "./api";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; reason?: "expired" | "signed-out" }
  | { status: "unavailable"; error: AdminApiError }
  | { status: "signed-in"; user: AdminUser; sessionExpiresAt: string };

const LOADING: AuthState = { status: "loading" };
let state: AuthState = LOADING;
const listeners = new Set<() => void>();
function set(next: AuthState): void { state = next; listeners.forEach((fn) => fn()); }
const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const getSnapshot = (): AuthState => state;
const getServerSnapshot = (): AuthState => LOADING;

let inflight: AbortController | null = null;
/** Bumped by every sign-in and sign-out. A slow "who am I?" answer that was asked BEFORE one of those must not overwrite what happened since. */
let epoch = 0;
let expiryTimer: number | null = null;

function armExpiry(): void {
  if (expiryTimer !== null) { window.clearTimeout(expiryTimer); expiryTimer = null; }
  if (state.status !== "signed-in") return;
  const ms = new Date(state.sessionExpiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return;
  // When the session's absolute lifetime is reached, send the owner to sign in instead of letting the next click fail.
  expiryTimer = window.setTimeout(() => { setCsrfToken(null); set({ status: "signed-out", reason: "expired" }); }, Math.min(Math.max(ms, 0), 2_147_000_000));
}

/** Asks the server who is signed in. Network or server trouble is shown as such; it is never taken to mean "signed out". */
export async function refresh(): Promise<void> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  const asked = epoch;
  try {
    const r = await api.me(ctl.signal);
    if (asked !== epoch) return;                                   // someone signed in or out while this was on its way: that is newer
    set({ status: "signed-in", user: r.user, sessionExpiresAt: r.session_expires_at });
    armExpiry();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (asked !== epoch) return;
    if (e instanceof AdminApiError && (e.status === 401 || e.status === 403)) {
      setCsrfToken(null);
      set(state.status === "signed-in" ? { status: "signed-out", reason: "expired" } : { status: "signed-out" });
      return;
    }
    set({ status: "unavailable", error: e instanceof AdminApiError ? e : new AdminApiError(0, "network") });
  }
}

/** Called by the sign-in screens once the server has issued a full session. */
export function signedIn(r: Pick<SignedIn, "user" | "session_expires_at" | "csrf_token">): void {
  epoch++;
  setCsrfToken(r.csrf_token);
  set({ status: "signed-in", user: r.user, sessionExpiresAt: r.session_expires_at });
  armExpiry();
}

/** Ends the session on the server first; the screen only changes once the server confirms (or says there is no session). */
export async function signOut(): Promise<void> {
  try {
    await api.logout();
  } catch (e) {
    // "Already signed out" is fine. Anything else means the session may still be live, so say so instead of pretending.
    if (!(e instanceof AdminApiError && e.status === 401)) throw e;
  }
  epoch++;
  setCsrfToken(null);
  set({ status: "signed-out", reason: "signed-out" });
  armExpiry();
}

export function useAuth(): { state: AuthState; signedIn: typeof signedIn; signOut: typeof signOut; refresh: typeof refresh } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { state: s, signedIn, signOut, refresh };
}

/** Mounted once around the owner area: finds out who is signed in, and keeps that fresh. */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void refresh();   // always ask on arrival: a copy kept from an earlier visit may be stale
    const off = onSessionLost(() => set({ status: "signed-out", reason: "expired" }));
    // Coming back to the tab: find out right away if the session was ended elsewhere or timed out.
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { off(); document.removeEventListener("visibilitychange", onVisible); inflight?.abort(); };
  }, []);
  return <>{children}</>;
}
