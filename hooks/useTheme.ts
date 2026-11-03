"use client";

import { useCallback, useSyncExternalStore } from "react";
import { FALLBACK_THEME, THEME_COLORS, THEME_KEY, type Theme } from "@/lib/theme";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const read = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");

function apply(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", THEME_COLORS[theme]);
  document.querySelectorAll('meta[name="theme-color"][media]').forEach((m) => m.setAttribute("content", THEME_COLORS[theme]));
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);

  // Another tab changed the saved choice.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY && (e.newValue === "light" || e.newValue === "dark")) apply(e.newValue);
  };
  // With no saved choice, follow the device if it switches (e.g. sunset auto dark mode).
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onSystem = () => {
    try {
      if (localStorage.getItem(THEME_KEY)) return;
    } catch {}
    apply(mq.matches ? "light" : "dark");
  };
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onSystem);
  };
}

/** Current theme plus a setter that persists to localStorage and briefly animates the colour change. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => FALLBACK_THEME);

  const set = useCallback((next: Theme) => {
    const root = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-switching");
      window.setTimeout(() => root.classList.remove("theme-switching"), 450);
    }
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    apply(next);
  }, []);

  return [theme, set];
}
