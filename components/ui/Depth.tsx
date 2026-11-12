"use client";

import { useRef, type ReactNode } from "react";
import { useGsap } from "@/hooks/useGsap";

interface DepthProps {
  children: ReactNode;
  /** Travel as a fraction of viewport height. Negative moves against the scroll (appears nearer). */
  speed?: number;
  className?: string;
}

/** One layer of a multi-layer parallax: wrap background/foreground elements with different speeds for depth. */
export function Depth({ children, speed = 0.15, className }: DepthProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGsap(ref, (gsap) => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const k = () => (window.innerWidth < 768 ? 0.5 : 1);
      gsap.fromTo(
        el,
        { y: () => -speed * k() * window.innerHeight },
        {
          y: () => speed * k() * window.innerHeight,
          ease: "none",
          scrollTrigger: {
            trigger: el.parentElement ?? el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
            invalidateOnRefresh: true,
          },
        },
      );
    });
  }, [speed]);

  return (
    <div ref={ref} className={className} data-depth>
      {children}
    </div>
  );
}
