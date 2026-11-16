"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TransitionProvider } from "@/components/providers/TransitionProvider";
import { SmoothScroll } from "@/components/providers/SmoothScroll";

/**
 * Wraps the public website's chrome (page transitions, smooth scroll, skip link, navbar, footer, desktop effects).
 * The owner area (/admin) is a private tool, not part of the marketing site, so it gets none of that: no navbar or footer, no custom
 * cursor, no scroll hijacking, no page-transition overlay. For every other path this renders exactly what the root layout rendered before.
 * The chrome arrives as slots so those components stay server-rendered; on /admin they are simply never mounted.
 */
export function SiteShell({ navbar, footer, effects, children }: { navbar: ReactNode; footer: ReactNode; effects: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname?.startsWith("/admin/")) return <>{children}</>;
  return (
    <TransitionProvider>
      <SmoothScroll>
        <a
          href="#main"
          className="fixed left-4 top-4 z-[200] -translate-y-24 rounded-full bg-gold px-5 py-3 text-xs font-bold uppercase tracking-widest text-ink focus:translate-y-0"
        >
          Skip to content
        </a>
        {navbar}
        <main id="main">{children}</main>
        {footer}
        {effects}
      </SmoothScroll>
    </TransitionProvider>
  );
}
