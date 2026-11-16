// Light/Dark choice for the OWNER area. This is the ONLY thing the owner screens may keep in the browser, and it is only ever the word
// "light" or "dark": no password, booking, guest or session data. (The public website has its own, separate choice in "nc-theme".)
// Kept outside lib/admin on purpose: the static security test forbids browser storage everywhere inside the admin folders, and a
// separate unit test (tests/unit/owner-theme.test.mjs) pins down exactly what this one file may store.

export type OwnerTheme = "light" | "dark";

export const OWNER_THEME_KEY = "nc-owner-theme";
/** The owner always starts in Light mode (the design's look) until they choose Dark. The device's own preference is deliberately ignored. */
export const OWNER_THEME_DEFAULT: OwnerTheme = "light";
/** Set on <html> while the owner area is open; the colour sets in styles/globals.css hang off it. */
export const OWNER_THEME_ATTR = "data-admin-theme";

export const isOwnerTheme = (v: unknown): v is OwnerTheme => v === "light" || v === "dark";

export function readSavedOwnerTheme(): OwnerTheme {
  try {
    const v = localStorage.getItem(OWNER_THEME_KEY);
    if (isOwnerTheme(v)) return v;
  } catch { /* storage blocked (private window, site data blocked): stay on the default */ }
  return OWNER_THEME_DEFAULT;
}

export function saveOwnerTheme(theme: OwnerTheme): void {
  try { localStorage.setItem(OWNER_THEME_KEY, theme); } catch { /* the choice just will not be remembered */ }
}

/**
 * Runs inline before the owner screens paint, so the saved theme is on <html> before anything is drawn (no flash of the wrong theme).
 * Anything other than exactly "light" or "dark" in storage is ignored.
 */
export const ownerThemeInitScript =
  `(function(){var t="${OWNER_THEME_DEFAULT}";try{var s=localStorage.getItem("${OWNER_THEME_KEY}");if(s==="light"||s==="dark")t=s}catch(e){}document.documentElement.setAttribute("${OWNER_THEME_ATTR}",t)})();`;
