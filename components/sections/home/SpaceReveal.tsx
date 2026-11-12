"use client";

import { useRef } from "react";
import Image from "next/image";
import { photo } from "@/lib/images";
import { useGsap } from "@/hooks/useGsap";
import { useSheetRadius } from "@/hooks/useSheetRadius";

/** Apple-style zoom reveal: a small framed photo expands to full-bleed as you scroll, then the copy lands. */
export function SpaceReveal() {
  const root = useRef<HTMLElement>(null);
  useSheetRadius(root);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: root.current, start: "top top", end: `+=${window.innerWidth < 768 ? 260 : 340}%`, scrub: 0.7, pin: true },
      });
      tl.fromTo(".sr-frame", { clipPath: "inset(28% 32% 28% 32% round 28px)" }, { clipPath: "inset(0% 0% 0% 0% round 0px)", duration: 1 }, 0)
        .fromTo(".sr-img", { scale: 1.6 }, { scale: 1, duration: 1 }, 0)
        .to(".sr-ghost", { scale: 1.6, opacity: 0, duration: 0.8 }, 0)
        .fromTo(".sr-copy > *", { y: 60, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.12, duration: 0.5 }, 0.75);
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(".sr-frame", { clipPath: "inset(0% 0% 0% 0% round 0px)" });
    });
  }, []);

  return (
    <section ref={root} className="theme-dark relative z-10 h-svh overflow-hidden bg-ink shadow-[0_-40px_80px_-20px_rgba(0,0,0,0.9)]">
      <div className="sr-ghost pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="display select-none text-[22vw] leading-none tracking-tight text-bone/[0.07]">VIBE</span>
      </div>

      <div className="sr-frame absolute inset-0" style={{ clipPath: "inset(28% 32% 28% 32% round 28px)" }}>
        <div className="sr-img absolute inset-0">
          <Image src={photo("dining", 2000)} alt="Lounge interior with leather banquettes and warm lighting" fill sizes="100vw" className="object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-ink/50" />
      </div>

      <div className="sr-copy container-x absolute inset-x-0 bottom-[12%] z-10 flex flex-col items-start gap-5 md:bottom-[14%]">
        <p className="eyebrow">The Atmosphere</p>
        <h2 className="display max-w-4xl text-5xl md:text-8xl">
          Unmistakable <span className="italic text-gold-gradient">atmosphere.</span>
        </h2>
        <p className="max-w-lg text-lg text-bone/75">
          Warm light, good company and a room with its own pulse. It&apos;s all part of the vibe.
        </p>
      </div>
    </section>
  );
}
