"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { FiMoon, FiSun } from "react-icons/fi";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { OWNER_THEME_ATTR, OWNER_THEME_DEFAULT, OWNER_THEME_KEY, isOwnerTheme, readSavedOwnerTheme, saveOwnerTheme, type OwnerTheme } from "@/lib/owner-theme";

// The theme lives on <html data-admin-theme>. That is what the colour sets in globals.css read, so it is right from the first paint (the
// inline script in OwnerThemeScript sets it before anything is drawn). React only mirrors it, via useSyncExternalStore.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const read = (): OwnerTheme => { const v = document.documentElement.getAttribute(OWNER_THEME_ATTR); return isOwnerTheme(v) ? v : OWNER_THEME_DEFAULT; };
function apply(theme: OwnerTheme): void { document.documentElement.setAttribute(OWNER_THEME_ATTR, theme); emit(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Another tab changed the saved choice: follow it.
  const onStorage = (e: StorageEvent) => { if (e.key === OWNER_THEME_KEY && isOwnerTheme(e.newValue)) apply(e.newValue); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

/** Mounted once around the owner area. On a full page load the inline script has already set the theme; when the owner arrives from the public
 *  site by a link (no page load) this applies it before the first paint. Leaving the owner area removes it, so the public site is untouched. */
export function OwnerThemeProvider({ children }: { children: ReactNode }) {
  useIsomorphicLayoutEffect(() => {
    apply(readSavedOwnerTheme());
    return () => { document.documentElement.removeAttribute(OWNER_THEME_ATTR); };
  }, []);
  return <>{children}</>;
}

export function useOwnerTheme(): [OwnerTheme, (t: OwnerTheme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => OWNER_THEME_DEFAULT);
  const set = useCallback((next: OwnerTheme) => {
    const root = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-switching");                      // brief cross-fade (rules already in globals.css)
      window.setTimeout(() => root.classList.remove("theme-switching"), 450);
    }
    saveOwnerTheme(next);
    apply(next);
  }, []);
  return [theme, set];
}

const MODES: { mode: OwnerTheme; label: string; Icon: typeof FiSun }[] = [
  { mode: "light", label: "Light", Icon: FiSun },
  { mode: "dark", label: "Dark", Icon: FiMoon },
];

/**
 * Visible, labelled Light | Dark switch. Two real buttons in a labelled group (Tab to reach, Enter or Space to choose); the current mode is
 * announced with aria-pressed. The highlight comes from CSS on <html data-admin-theme>, so it is right before any JavaScript runs.
 */
export function OwnerThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useOwnerTheme();
  return (
    <div role="group" aria-label="Colour theme" data-testid="theme-toggle" className={`owner-toggle flex items-center gap-0.5 rounded-full border border-line bg-ink p-0.5 ${className}`}>
      {MODES.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          data-mode={mode}
          aria-pressed={theme === mode}
          title={`${label} mode`}
          onClick={() => setTheme(mode)}
          className="owner-toggle-btn flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        >
          <Icon size={14} aria-hidden />
          <span>{label}<span className="sr-only"> mode</span></span>
        </button>
      ))}
    </div>
  );
}
