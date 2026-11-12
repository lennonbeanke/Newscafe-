import { useEffect, type DependencyList, type RefObject } from "react";
import { gsap } from "@/lib/gsap";

/**
 * Create a section's GSAP/ScrollTrigger setup only once it is approaching the viewport.
 *
 * Every ScrollTrigger re-measures the page when created and every pin queues a full refresh, so building
 * ~35 triggers during hydration blocks the main thread for seconds on mid-range phones. Creating them
 * lazily (top to bottom, as you scroll) keeps first load fast and still has them ready before they're seen.
 * `setup` receives the gsap instance, so components never import it directly.
 */
export function useGsap(scope: RefObject<Element | null>, setup: (g: typeof gsap) => void, deps: DependencyList = [], margin = "150% 0px") {
  useEffect(() => {
    const el = scope.current;
    if (!el) return;
    let ctx: gsap.Context | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        ctx = gsap.context(() => setup(gsap), el);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ctx?.revert();
    };
    // `setup` is intentionally captured per `deps`, like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
