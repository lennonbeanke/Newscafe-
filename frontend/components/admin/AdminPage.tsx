"use client";

import type { ReactNode } from "react";
import { AdminShell } from "./AdminShell";
import { RequireAuth } from "./RequireAuth";

/** Every signed-in owner screen: nothing renders until the server confirms a full session, then the shared header and navigation. */
export function AdminPage({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AdminShell>{children}</AdminShell>
    </RequireAuth>
  );
}
