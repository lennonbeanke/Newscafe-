"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiCalendar, FiClipboard, FiGrid, FiLogOut, FiMenu, FiShield, FiX } from "react-icons/fi";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuth } from "@/lib/admin/auth";
import { AdminApiError } from "@/lib/admin/api";
import { friendlyMessage } from "@/lib/admin/pure";
import { cn } from "@/lib/utils";
import { OwnerThemeToggle } from "@/components/owner-theme/OwnerTheme";
import { Notice } from "./ui";

const LINKS = [
  { href: "/admin", label: "Overview", Icon: FiGrid },
  { href: "/admin/reservations", label: "Reservations", Icon: FiCalendar },
];
// Built in later checkpoints. Shown greyed out so the layout matches the design; they are not links and do nothing yet.
const COMING_SOON = [
  { label: "Audit History", Icon: FiClipboard },
  { label: "Security Settings", Icon: FiShield },
];

const itemBase = "relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--nav-gold)] md:max-lg:justify-center";
// Below 1024px wide the sidebar is icons only (the words stay available to screen readers); below 768px it is a slide-out panel.
const labelCls = "md:max-lg:sr-only";

/**
 * Frame for every signed-in owner screen: a dark charcoal sidebar (logo, navigation, Logout), a top bar (Light/Dark switch, who is signed in),
 * and the page. Logout ends the session on the server. Later checkpoints add their pages to the sidebar.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const mobile = useMediaQuery("(max-width: 767px)");
  const open = menuOpen && mobile;                       // the slide-out panel only exists on phones
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const giveFocusBack = useRef(false);
  const closeMenu = (refocus: boolean) => { giveFocusBack.current = refocus; setMenuOpen(false); };

  useEffect(() => {
    if (!open) {
      // The page behind the menu is inert while it is open, so focus can only go back to the Menu button once it has re-rendered.
      if (giveFocusBack.current) { giveFocusBack.current = false; menuButton.current?.focus(); }
      return;
    }
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(true); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (state.status !== "signed-in") return null;

  const onSignOut = async () => {
    setBusy(true); setError(null);
    try { await signOut(); }
    catch (e) { setError(friendlyMessage(e instanceof AdminApiError ? e : new AdminApiError(0, "network"))); setBusy(false); }
  };

  return (
    <div className="min-h-svh">
      {open ? <div className="fixed inset-0 z-30 bg-black/55 md:hidden" aria-hidden onClick={() => closeMenu(true)} /> : null}

      <aside
        id="owner-nav"
        aria-label="Sidebar"
        data-testid="sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-y-auto bg-[var(--nav-bg)] text-[var(--nav-text)] md:visible md:w-16 md:translate-x-0 lg:w-64",
          // Phone: slides in at once visible (so focus can move into it) and, when closing, becomes unfocusable only after it has slid away.
          open ? "max-md:[transition:transform_200ms,visibility_0s]" : "max-md:invisible max-md:-translate-x-full max-md:[transition:transform_200ms,visibility_0s_200ms]",
        )}
      >
        <div className="flex items-center justify-between px-4 pt-5 md:max-lg:justify-center md:max-lg:px-1">
          <Link href="/admin" aria-label="News Cafe: Overview" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--nav-gold)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- placeholder logo, a plain local SVG */}
            <img src="/admin/news-cafe-logo.svg" alt="News Cafe" width={220} height={64} className="h-12 w-auto md:max-lg:hidden" />
            <span aria-hidden className="hidden font-display text-2xl font-semibold tracking-wider text-[var(--nav-gold)] md:max-lg:block">NC</span>
          </Link>
          <button ref={closeButton} type="button" onClick={() => closeMenu(true)} aria-label="Close menu" className="rounded-lg p-2 text-[var(--nav-mute)] outline-none hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--nav-gold)] md:hidden">
            <FiX size={20} aria-hidden />
          </button>
        </div>
        <p className="mt-1 px-4 text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[var(--nav-faint)] md:max-lg:hidden">Owner dashboard</p>

        <nav aria-label="Owner sections" className="mt-6 px-3 md:max-lg:px-2">
          <ul className="space-y-1">
            {LINKS.map(({ href, label, Icon }) => {
              const here = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={here ? "page" : undefined}
                    title={label}
                    onClick={() => setMenuOpen(false)}
                    className={cn(itemBase, here ? "bg-[var(--nav-active)] text-[var(--nav-gold)] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--nav-gold)]" : "text-[var(--nav-mute)] hover:bg-white/5 hover:text-[var(--nav-text)]")}
                  >
                    <Icon size={18} aria-hidden className="shrink-0" />
                    <span className={labelCls}>{label}</span>
                  </Link>
                </li>
              );
            })}
            {COMING_SOON.map(({ label, Icon }) => (
              <li key={label}>
                <span title={`${label}: coming soon`} data-testid="coming-soon" className="relative flex cursor-not-allowed select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--nav-faint)] md:max-lg:justify-center">
                  <Icon size={18} aria-hidden className="shrink-0" />
                  <span className={cn("flex flex-col leading-tight", labelCls)}>
                    <span>{label}</span>{" "}
                    <span className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wider">Coming soon</span>
                  </span>
                </span>
              </li>
            ))}
            <li className="pt-2">
              <div className="mb-2 border-t border-[var(--nav-line)]" />
              <button type="button" onClick={onSignOut} disabled={busy} aria-busy={busy || undefined} title="Logout" className={cn(itemBase, "text-[var(--nav-mute)] hover:bg-white/5 hover:text-[var(--nav-text)] disabled:cursor-not-allowed disabled:opacity-60")}>
                <FiLogOut size={18} aria-hidden className="shrink-0" />
                <span className={labelCls}>{busy ? "Logging out…" : "Logout"}</span>
              </button>
            </li>
          </ul>
        </nav>

        <div className="mt-auto md:max-lg:hidden">
          <p className="truncate px-5 pb-3 text-xs text-[var(--nav-mute)] md:hidden" data-testid="drawer-email">{state.user.email}</p>
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- placeholder picture, a plain local SVG */}
            <img src="/admin/coffee-cup-placeholder.svg" alt="" width={320} height={180} className="h-32 w-full object-cover" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--nav-bg)] to-transparent" />
          </div>
          <div className="bg-[var(--nav-bg)] px-4 pb-5 pt-1">
            <p className="text-center font-display text-2xl italic leading-none text-[var(--nav-gold)]">Good Food Good Mood</p>
          </div>
        </div>
      </aside>

      <div inert={open} className="md:pl-16 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-onyx/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button ref={menuButton} type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="owner-nav" className="-ml-2 rounded-lg p-2 text-bone outline-none hover:text-gold focus-visible:ring-2 focus-visible:ring-gold/70 md:hidden">
              <FiMenu size={22} aria-hidden />
            </button>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.28em] text-gold md:hidden">News Cafe</p>
            <div className="ml-auto flex items-center gap-3 sm:gap-4">
              <OwnerThemeToggle />
              <span className="hidden max-w-[16rem] truncate text-sm text-mist sm:inline" data-testid="signed-in-email">{state.user.email}</span>
            </div>
          </div>
          {error ? <div className="px-4 pb-4 sm:px-6"><Notice tone="error">{error} Your session may still be active; try again.</Notice></div> : null}
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
