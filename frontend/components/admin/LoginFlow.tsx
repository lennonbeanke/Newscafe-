"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/admin/api";
import { AdminApiError } from "@/lib/admin/api";
import { useAuth } from "@/lib/admin/auth";
import { friendlyMessage, isEmail, safeNextPath } from "@/lib/admin/pure";
import { AdminButton, AuthCard, Notice, TextField } from "./ui";

interface Failure { message: string; requestId?: string }

/**
 * Owner login: e-mail address and password, nothing else. A correct password starts a full session at once and goes straight on to the
 * dashboard (or the page that was asked for). The password lives only in this component's memory and is cleared after every attempt;
 * nothing is put in the URL, localStorage, sessionStorage or cookies by this code (the session cookie is HttpOnly and set by the server).
 */
export function LoginFlow({ next, notice }: { next: string | null; notice?: "expired" | "signed-out" }) {
  const router = useRouter();
  const { signedIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const emailOk = isEmail(email);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (!emailOk || password.length === 0) return;
    setBusy(true); setFailure(null);
    try {
      const r = await api.login(email.trim(), password);
      setPassword("");
      signedIn(r);
      router.replace(safeNextPath(next));
    } catch (e) {
      const err = e instanceof AdminApiError ? e : new AdminApiError(0, "network");
      setPassword(""); setTouched(false);                                       // clear the password; don't also nag "Enter your password" under the error
      setFailure({ message: friendlyMessage(err, "password"), requestId: err.requestId });
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Owner login" subtitle="Sign in with your e-mail address and password.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {notice === "expired" && !failure ? <Notice tone="info">Your session ended. Please sign in again.</Notice> : null}
        {notice === "signed-out" && !failure ? <Notice tone="info">You have been signed out.</Notice> : null}
        {failure ? <Notice tone="error" requestId={failure.requestId}>{failure.message}</Notice> : null}
        <TextField
          label="E-mail address" type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
          required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          error={touched && !emailOk ? "Enter a valid e-mail address." : null}
        />
        <TextField
          label="Password" type="password" name="password" autoComplete="current-password" required maxLength={128}
          value={password} onChange={(e) => setPassword(e.target.value)}
          error={touched && password.length === 0 ? "Enter your password." : null}
        />
        <AdminButton type="submit" busy={busy}>{busy ? "Signing in…" : "Sign in"}</AdminButton>
      </form>
    </AuthCard>
  );
}
