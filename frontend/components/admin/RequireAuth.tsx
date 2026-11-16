"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/admin/auth";
import { friendlyMessage } from "@/lib/admin/pure";
import { AdminButton, Notice, Spinner } from "./ui";

/**
 * Wraps every owner-only screen. Nothing inside is rendered (so nothing is fetched or shown) until the server has confirmed a full
 * session. Signed-out visitors are sent to the sign-in screen with a safe `next` path. If the service is down we say so and offer a
 * retry, instead of guessing that the session ended.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status !== "signed-out") return;
    const next = pathname && pathname !== "/admin" ? `?next=${encodeURIComponent(pathname)}` : "";
    const reason = state.reason === "expired" ? `${next ? "&" : "?"}reason=expired` : "";
    router.replace(`/admin/login${next}${reason}`);
  }, [state, pathname, router]);

  if (state.status === "signed-in") return <>{children}</>;
  if (state.status === "unavailable") {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-24">
        <Notice tone="error" requestId={state.error.requestId}>{friendlyMessage(state.error)}</Notice>
        <AdminButton variant="secondary" onClick={() => void refresh()}>Try again</AdminButton>
      </div>
    );
  }
  return <Spinner label={state.status === "signed-out" ? "Redirecting to sign-in…" : "Checking your session…"} />;
}
