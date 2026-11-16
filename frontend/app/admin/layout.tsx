import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/admin/auth";
import { OwnerThemeProvider } from "@/components/owner-theme/OwnerTheme";
import { OwnerThemeScript } from "@/components/owner-theme/OwnerThemeScript";

// The owner area is private: never indexed, never cached (response headers are set in next.config.ts).
export const metadata: Metadata = {
  title: { default: "Owner", template: "%s — Owner" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* First in the page: sets the saved Light/Dark choice on <html> before anything is painted (default Light) */}
      <OwnerThemeScript />
      <OwnerThemeProvider>
        <AuthProvider>
          <div className="min-h-svh bg-coal text-bone">{children}</div>
        </AuthProvider>
      </OwnerThemeProvider>
    </>
  );
}
