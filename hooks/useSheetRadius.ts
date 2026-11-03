import { type RefObject } from "react";
import { useGsap } from "./useGsap";

/** Rounded top corners that flatten as the section arrives, so it reads as a card sliding over the previous one. */
export function useSheetRadius(ref: RefObject<HTMLElement | null>, radius = 44) {
  useGsap(ref, (gsap) => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        el,
        { borderTopLeftRadius: radius, borderTopRightRadius: radius },
        {
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "top top", scrub: true },
        },
      );
    });
  }, [radius, ref]);
}
