"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared SVG filter. Mounted once in the layout; `Distort` animates its displacement scale on hover. */
export function DistortDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <defs>
        <filter id="lux-ripple" x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
          <feTurbulence id="lux-turb" type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap id="lux-disp" in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

type Timeline = { kill: () => unknown };
let active: Timeline | null = null;
let activeEl: HTMLElement | null = null;

async function ripple(el: HTMLElement, strength: number) {
  const { gsap } = await import("@/lib/gsap");
  const disp = document.getElementById("lux-disp");
  const turb = document.getElementById("lux-turb");
  if (!disp || !turb) return;
  active?.kill();
  if (activeEl && activeEl !== el) activeEl.style.filter = "";
  activeEl = el;
  el.style.filter = "url(#lux-ripple)";

  const o = { s: 0, f: 0.006 };
  const apply = () => {
    disp.setAttribute("scale", o.s.toFixed(1));
    turb.setAttribute("baseFrequency", `${o.f.toFixed(4)} ${(o.f * 2).toFixed(4)}`);
  };
  active = gsap
    .timeline({ onUpdate: apply, onComplete: () => { el.style.filter = ""; activeEl = null; } })
    .to(o, { s: strength, f: 0.011, duration: 0.45, ease: "power2.out" })
    .to(o, { s: 0, f: 0.006, duration: 1.3, ease: "elastic.out(1, 0.55)" });
}

/** Wrap an image: on hover (fine pointers, motion allowed) it ripples like liquid glass. */
export function Distort({ children, className, strength = 38 }: { children: ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={cn(className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse" || !ref.current) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        ripple(ref.current, strength);
      }}
    >
      {children}
    </div>
  );
}
