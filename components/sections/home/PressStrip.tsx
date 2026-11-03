import { phrases } from "@/lib/data";
import { Marquee } from "@/components/ui/Marquee";

/** First "sheet": rises over the pinned hero with softly rounded top corners. */
export function PressStrip() {
  return (
    <section
      aria-label="News Cafe"
      className="relative z-10 -mt-10 rounded-t-[2.5rem] border-t border-line bg-ink py-12 shadow-[0_-40px_80px_-20px_var(--sheet-shadow)] md:py-16"
    >
      <Marquee items={phrases} className="display text-4xl italic text-bone/80 md:text-6xl" />
    </section>
  );
}
