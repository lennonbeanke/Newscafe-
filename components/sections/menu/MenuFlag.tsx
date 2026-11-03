import { MENU_FLAG_ENABLED, MENU_FLAG_LABEL } from "@/lib/menu-data";

/**
 * The original menus print an "N" badge on some items but never say what it means, so this renders nothing until
 * MENU_FLAG_ENABLED is switched on in lib/menu-data.ts (and MENU_FLAG_LABEL is set to the confirmed wording).
 */
export function MenuFlag({ marked }: { marked?: boolean }) {
  if (!MENU_FLAG_ENABLED || !marked) return null;
  return (
    <span className="ml-2 inline-flex translate-y-[-0.15em] items-center rounded-full bg-gold px-2 py-0.5 align-middle font-sans text-[0.55rem] font-bold uppercase tracking-[0.16em] text-ink">
      {MENU_FLAG_LABEL}
    </span>
  );
}
