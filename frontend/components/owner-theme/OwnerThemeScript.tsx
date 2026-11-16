import { ownerThemeInitScript } from "@/lib/owner-theme";

/** Inline, blocking: puts the saved Light/Dark choice on <html> before the owner screens are painted. Rendered first in the owner layout. */
export function OwnerThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: ownerThemeInitScript }} />;
}
