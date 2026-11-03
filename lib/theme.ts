export type Theme = "light" | "dark";

export const THEME_KEY = "nc-theme";
/** Used when a visitor has no saved choice and their device doesn't say which they prefer. */
export const FALLBACK_THEME: Theme = "dark";
export const THEME_COLORS: Record<Theme, string> = { dark: "#060606", light: "#f8f3ea" };

/**
 * Runs inline in <head>, before first paint, so the page never flashes the wrong theme.
 * Order of precedence: saved choice → device preference → FALLBACK_THEME.
 */
export const themeInitScript = `(function(){var d=document.documentElement,t;try{var s=localStorage.getItem("${THEME_KEY}");if(s==="light"||s==="dark")t=s}catch(e){}if(!t){try{t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){t="${FALLBACK_THEME}"}}d.setAttribute("data-theme",t)})();`;
