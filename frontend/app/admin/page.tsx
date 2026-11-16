"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { Overview } from "@/components/admin/dashboard/Overview";
import { RequireAuth } from "@/components/admin/RequireAuth";

/** The owner dashboard: signed-in owners only (RequireAuth), read-only overview in this step. */
export default function AdminHome() {
  return (
    <RequireAuth>
      <AdminShell>
        <Overview />
      </AdminShell>
    </RequireAuth>
  );
}
