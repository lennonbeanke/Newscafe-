"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { m as motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useGsap } from "@/hooks/useGsap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SplitReveal } from "@/components/ui/SplitReveal";

interface PageHeroProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  image: string;
  alt: string;
}

/** Apple-style hero: as you scroll the image scales back and the copy drifts up and fades; a soft spotlight follows the cursor. */
export function PageHero({ eyebrow, title, subtitle, image, alt }: PageHeroProps) {
  const root = useRef<HTMLElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const fine = useMediaQuery("(pointer: fine)");
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 90, damping: 22 });
  const sy = useSpring(my, { stiffness: 90, damping: 22 });
  const spotX = useTransform(sx, (v) => v - 400);
  const spotY = useTransform(sy, (v) => v - 400);
  const fx = fine && !reduce;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mx.set(r.width * 0.7);
    my.set(r.height * 0.4);
    if (!fine || reduce) return;
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      mx.set(e.clientX - b.left);
      my.set(e.clientY - b.top);
    };
    el.addEventListener("pointermove", move, { passive: true });
    return () => el.removeEventListener("pointermove", move);
  }, [fine, reduce, mx, my]);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: true };
      gsap.to(bg.current, { scale: 1.25, yPercent: 12, ease: "none", scrollTrigger: st });
      gsap.to(copy.current, { yPercent: -25, opacity: 0, ease: "none", scrollTrigger: st });
    });
  }, []);

  return (
    <section ref={root} className="theme-dark relative flex min-h-[85svh] items-end overflow-hidden pb-20 pt-40 md:min-h-[92svh] md:pb-28">
      <div ref={bg} className="absolute inset-0 will-change-transform">
        <div className="absolute inset-0 animate-[kenburns_2.6s_cubic-bezier(0.16,1,0.3,1)_both]">
          <Image src={image} alt={alt} fill priority sizes="100vw" quality={70} className="object-cover" />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(6,6,6,0.75)_100%)]" />
      {fx && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-[800px] w-[800px] rounded-full bg-[radial-gradient(closest-side,rgba(255,226,160,0.22),transparent)] mix-blend-screen will-change-transform"
          style={{ x: spotX, y: spotY }}
        />
      )}
      <div className="grain absolute inset-0 overflow-hidden" />

      <div ref={copy} className="container-x relative z-10">
        <p className="eyebrow intro-fade mb-6 [--d:0.1s]">{eyebrow}</p>
        <SplitReveal
          as="h1"
          by="char"
          text={title}
          trigger="intro"
          delay={0.15}
          className="max-w-5xl text-6xl md:text-8xl lg:text-[9.5rem]"
        />
        <span aria-hidden className="intro-grow mt-8 block h-px w-full max-w-md bg-gradient-to-r from-gold to-transparent [--d:0.5s]" />
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-bone/75 md:text-xl">{subtitle}</p>
      </div>

      {/* Same side gutter as the logo and copy, so the right edge mirrors the left. */}
      <div className="container-x pointer-events-none absolute inset-x-0 bottom-8 hidden justify-end md:flex">
        <div className="intro-fade flex items-center gap-3 [--d:0.9s]">
          <span className="eyebrow text-mist">Scroll</span>
          <span className="relative block h-12 w-px overflow-hidden bg-line">
            <span className="absolute inset-x-0 top-0 h-1/2 animate-[scroll-cue_1.8s_ease-in-out_infinite] bg-gold" />
          </span>
        </div>
      </div>
    </section>
  );
}
