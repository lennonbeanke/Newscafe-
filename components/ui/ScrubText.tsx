"use client";

import { useRef } from "react";
import { parseAccent } from "@/lib/text";
import { cn } from "@/lib/utils";
import { useGsap } from "@/hooks/useGsap";

/** Paragraph whose words brighten one by one in step with the scrollbar. */
export function ScrubText({ text, className }: { text: string; className?: string }) {
  const root = useRef<HTMLParagraphElement>(null);
  const words = parseAccent(text);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(".sc-word", {
        opacity: 1,
        stagger: 0.1,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top 82%", end: "bottom 45%", scrub: true },
      });
    });
    mm.add("(prefers-reduced-motion: reduce)", () => gsap.set(".sc-word", { opacity: 1 }));
  }, []);

  return (
    <p ref={root} className={cn("display", className)}>
      {words.map(({ w, accent }, i) => (
        <span key={i} className={cn("sc-word inline-block opacity-40", accent && "italic text-gold-gradient")}>
          {w}&nbsp;
        </span>
      ))}
    </p>
  );
}
