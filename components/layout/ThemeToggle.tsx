"use client";

import { FiMoon, FiSun } from "react-icons/fi";
import { useTheme } from "@/hooks/useTheme";
import type { Theme } from "@/lib/theme";

const modes: { mode: Theme; label: string; Icon: typeof FiSun }[] = [
  { mode: "light", label: "Light mode", Icon: FiSun },
  { mode: "dark", label: "Dark mode", Icon: FiMoon },
];

/**
 * Sun | Moon switch. Two real buttons (Tab to reach, Enter/Space to choose) in a labelled group; the active one
 * is exposed with aria-pressed. The highlight is driven by CSS from <html data-theme>, so it is correct from the
 * very first paint, before any JavaScript has run.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <div role="group" aria-label="Colour theme" className={`theme-toggle flex items-center gap-0.5 rounded-full border border-line p-0.5 ${className}`}>
      {modes.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          data-mode={mode}
          aria-pressed={theme === mode}
          aria-label={label}
          title={label}
          onClick={() => setTheme(mode)}
          className="theme-btn flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-300 md:h-8 md:w-8"
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
