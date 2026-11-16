// Browser client for the OWNER API. The browser only ever talks to /api/admin/* on the dashboard's own origin; Next proxies that path
// to the owner API process (see next.config.ts). The public booking API is never used here.
//
// Storage rules: the session lives in an HttpOnly cookie set by the API (this code cannot read it). The per-session CSRF token is kept
// ONLY in memory (a module variable) and is re-fetched from /me after a reload. Nothing is written to localStorage, sessionStorage,
// IndexedDB or document.cookie.
import { ADMIN_API_BASE, buildHeaders, type ErrorInfo } from "./pure";

export interface AdminUser { email: string; role: string }
export interface SignedIn { signed_in: true; csrf_token: string; user: AdminUser; session_expires_at: string }
export interface Me { user: AdminUser; csrf_token: string; session_expires_at: string; idle_timeout_seconds: number }

export class AdminApiError extends Error implements ErrorInfo {
  readonly status: number;
  readonly code: string;
  readonly apiMessage?: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  constructor(status: number, code: string, apiMessage?: string, requestId?: string, retryAfterSeconds?: number) {
    super(`${status} ${code}`);
    this.name = "AdminApiError";
    this.status = status; this.code = code; this.apiMessage = apiMessage; this.requestId = requestId; this.retryAfterSeconds = retryAfterSeconds;
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null): void => { csrfToken = token; };

type Listener = () => void;
const sessionLostListeners = new Set<Listener>();
/** The provider listens here: any "not signed in" answer to a signed-in request sends the owner back to the sign-in screen. */
export function onSessionLost(fn: Listener): () => void { sessionLostListeners.add(fn); return () => { sessionLostListeners.delete(fn); }; }

interface Options { signal?: AbortSignal; /** do not treat a 401 as "your session ended" (used during the sign-in steps themselves) */ duringSignIn?: boolean }

async function request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ADMIN_API_BASE}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: buildHeaders(method, csrfToken, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new AdminApiError(0, "network");
  }
  let data: unknown = null;
  let parsed = false;
  try { data = await res.json(); parsed = true; }
  catch (e) {
    // A request cancelled while its answer was still arriving must stay a cancellation (never an empty "success").
    if (e instanceof DOMException && e.name === "AbortError") throw e;
  }
  if (res.ok) {
    if (res.status === 204) return null as T;                                            // e.g. logout: success with no body
    if (!parsed || typeof data !== "object" || data === null) throw new AdminApiError(res.status, "bad_response");   // never hand an empty answer to a screen
    return data as T;
  }
  const d = (data && typeof data === "object" ? data : {}) as { error?: unknown; message?: unknown; request_id?: unknown };
  const retry = Number(res.headers.get("Retry-After"));
  const err = new AdminApiError(
    res.status,
    typeof d.error === "string" ? d.error : "error",
    typeof d.message === "string" ? d.message : undefined,
    typeof d.request_id === "string" ? d.request_id : undefined,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
  if (res.status === 401 && err.code === "unauthenticated" && !opts.duringSignIn) { csrfToken = null; sessionLostListeners.forEach((fn) => fn()); }
  throw err;
}

// ---- sign-in: e-mail and password, nothing else; a correct password is a full session straight away ---------------------------------------
export async function login(email: string, password: string): Promise<SignedIn> {
  const r = await request<SignedIn>("POST", "/login", { email, password }, { duringSignIn: true });
  csrfToken = r.csrf_token;
  return r;
}

// ---- signed-in calls ---------------------------------------------------------------------------------------------------------------
export async function me(signal?: AbortSignal): Promise<Me> {
  const r = await request<Me>("GET", "/me", undefined, { signal, duringSignIn: true });
  csrfToken = r.csrf_token;
  return r;
}
/** Read-only call for the dashboard screens. Only plain query values; a 401 ends the session on screen (the provider listens). */
export function adminGet<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return request<T>("GET", `${path}${suffix}`, undefined, { signal });
}
/** State-changing calls for the dashboard screens. They carry the CSRF header and token; the owner API checks Origin, header and token again. */
export function adminPost<T>(path: string, body?: unknown): Promise<T> { return request<T>("POST", path, body); }
export function adminPatch<T>(path: string, body: unknown): Promise<T> { return request<T>("PATCH", path, body); }
export async function logout(): Promise<void> {
  await request<unknown>("POST", "/logout", undefined, { duringSignIn: true });
  csrfToken = null;
}
