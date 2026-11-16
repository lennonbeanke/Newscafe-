"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginFlow } from "@/components/admin/LoginFlow";
import { Spinner } from "@/components/admin/ui";
import { useAuth } from "@/lib/admin/auth";
import { safeNextPath } from "@/lib/admin/pure";

function LoginScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { state } = useAuth();
  const next = params.get("next");
  const reason = params.get("reason") === "expired" ? "expired" : state.status === "signed-out" ? state.reason : undefined;

  // Someone who is already signed in has no use for this screen.
  useEffect(() => {
    if (state.status === "signed-in") router.replace(safeNextPath(next));
  }, [state.status, next, router]);

  if (state.status === "loading" || state.status === "signed-in") return <Spinner label="Checking your session…" />;
  return (
    <div className="px-6 py-16 sm:py-24">
      <LoginFlow next={next} notice={reason} />
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <main id="main">
      <Suspense fallback={<Spinner label="Loading…" />}>
        <LoginScreen />
      </Suspense>
    </main>
  );
}
