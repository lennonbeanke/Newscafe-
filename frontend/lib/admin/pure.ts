// Pure helpers for the owner (admin) sign-in screens. No React, no DOM, no network: this file is unit-tested with `node --test`.
// Nothing here ever stores anything (no cookies, no localStorage, no sessionStorage).

export const ADMIN_API_BASE = "/api/admin";
/** The API (admin-app.ts) refuses a state-changing request unless it carries exactly this value. */
export const CSRF_HEADER_VALUE = "newscafe-admin";

/** Headers for a request to the owner API. State-changing methods carry the CSRF header and the per-session CSRF token. */
export function buildHeaders(method: string, csrfToken: string | null, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    headers["X-Requested-With"] = CSRF_HEADER_VALUE;
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }
  return headers;
}

// ---- inputs ---------------------------------------------------------------------------------------------------------------

export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;

// ---- redirects --------------------------------------------------------------------------------------------------------------

/**
 * Where to go after signing in. Only a path inside the admin area is ever accepted, so a crafted `?next=` link can never send the
 * owner to another site (open redirect). Anything else falls back to /admin.
 */
export function safeNextPath(next: string | null | undefined): string {
  const fallback = "/admin";
  if (!next || next.length > 200) return fallback;
  if (!/^\/admin(\/[A-Za-z0-9._~\-\/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/.test(next)) return fallback;
  if (next.includes("//") || next.includes("..")) return fallback;
  if (next === "/admin/login" || next.startsWith("/admin/login/") || next.startsWith("/admin/login?")) return fallback;
  return next;
}

// ---- error messages -----------------------------------------------------------------------------------------------------------

export type AuthContext = "password" | "other";
export interface ErrorInfo { status: number; code: string; apiMessage?: string; retryAfterSeconds?: number }

/**
 * Plain-language message for an error from the owner API. The wording never reveals whether an e-mail address exists, whether an
 * account is locked, or anything the API itself keeps secret; it only repeats what the API already says to every caller.
 */
export function friendlyMessage(e: ErrorInfo, context: AuthContext = "other"): string {
  if (e.code === "network") return "We could not reach the admin service. Check that it is running, then try again.";
  if (e.status === 429 || e.code === "rate_limited") {
    const m = e.retryAfterSeconds ? Math.max(1, Math.ceil(e.retryAfterSeconds / 60)) : null;
    return m ? `Too many attempts. Please wait about ${m} minute${m === 1 ? "" : "s"} and try again.` : "Too many attempts. Please wait a few minutes and try again.";
  }
  if (e.code === "invalid_credentials") return "The e-mail address or password is not correct.";
  if (e.status === 401) {
    return context === "password" ? "The e-mail address or password is not correct." : "You are not signed in. Please sign in again.";
  }
  if (e.status === 403 && e.code.startsWith("csrf")) return "This request was blocked for your safety. Reload the page and try again.";
  if (e.status === 403) return "You are not allowed to do that.";
  if (e.status === 422) return "Please check what you entered and try again.";
  if (e.code === "outcome_unknown") return "We could not confirm whether that change was saved. Reload this booking to check before trying again.";
  if (e.status === 404) return "That booking could not be found. It may have been removed.";
  if (e.status === 503 || e.status >= 500) return "The service is temporarily unavailable. Please try again in a moment.";
  return e.apiMessage && e.apiMessage.length <= 200 ? e.apiMessage : "Something went wrong. Please try again.";
}

