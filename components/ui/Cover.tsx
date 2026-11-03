"use client";

import { useRef, type ReactNode } from "react";
import { useGsap } from "@/hooks/useGsap";

/**
 * Seamless section transition: once this section's bottom reaches the viewport bottom it stays pinned
 * while the next section (give it `relative z-10` + an opaque background) slides over it.
 * The covered section recedes (scale + dim) for depth.
 */
export function Cover({ children, distance = 100 }: { children: ReactNode; distance?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGsap(outer, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const st = { trigger: outer.current, start: "bottom bottom", end: `+=${distance}%` };
      gsap.timeline({ scrollTrigger: { ...st, pin: true, pinSpacing: false } });
      gsap.to(inner.current, {
        scale: 0.93,
        opacity: 0.25,
        ease: "none",
        scrollTrigger: { ...st, scrub: true },
      });
    });
  }, [distance]);

  return (
    <div ref={outer} className="relative z-0">
      <div ref={inner} className="origin-[50%_85%] will-change-transform">
        {children}
      </div>
    </div>
  );
}
