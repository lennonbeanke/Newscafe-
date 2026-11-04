"use client";

import { useRef } from "react";
import Image from "next/image";
import { useGsap } from "@/hooks/useGsap";
import { cn } from "@/lib/utils";

interface ParallaxImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Vertical travel of the image in % of its height. */
  speed?: number;
  /** Clip-path "curtain" reveal as the frame enters the viewport. */
  reveal?: boolean;
  priority?: boolean;
  sizes?: string;
  cursor?: string;
}

/** Image that drifts inside its frame on scroll (GSAP ScrollTrigger scrub) with an optional wipe reveal. */
export function ParallaxImage({
  src,
  alt,
  className,
  speed = 14,
  reveal = true,
  priority,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  cursor,
}: ParallaxImageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGsap(frame, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        inner.current,
        { yPercent: -speed, scale: 1.25 },
        {
          yPercent: speed,
          scale: 1.25,
          ease: "none",
          scrollTrigger: { trigger: frame.current, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
      if (reveal) {
        gsap.fromTo(
          frame.current,
          { clipPath: "inset(14% 8% 14% 8% round 24px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 0px)",
            ease: "power3.out",
            scrollTrigger: { trigger: frame.current, start: "top 92%", end: "top 35%", scrub: 0.6 },
          },
        );
      }
    });
  }, [speed, reveal]);

  return (
    <div ref={frame} className={cn("relative overflow-hidden", className)} data-cursor={cursor}>
      <div ref={inner} className="absolute inset-0 will-change-transform">
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
    </div>
  );
}
