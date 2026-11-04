"use client";

import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";

const ease = [0.65, 0, 0.35, 1] as const;

/** Art-deco divider: two hairlines grow outward from a diamond that draws itself. */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 24" className={cn("h-6 w-full max-w-sm text-gold", className)} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <motion.path d="M200 12 H8" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease }} />
      <motion.path d="M200 12 H392" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease }} />
      <motion.path d="M200 3 L209 12 L200 21 L191 12 Z" fill="currentColor" initial={{ pathLength: 0, fillOpacity: 0 }} whileInView={{ pathLength: 1, fillOpacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.8, ease }} />
      <motion.path d="M177 12 l5 -4 l5 4 l-5 4 z M213 12 l5 -4 l5 4 l-5 4 z" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 1.1, ease }} />
    </svg>
  );
}

/** A gold keyline that traces itself around its parent (parent must be `relative`). */
export function DrawFrame({ className, radius = 24, delay = 0 }: { className?: string; radius?: number; delay?: number }) {
  return (
    <svg className={cn("pointer-events-none absolute inset-0 h-full w-full overflow-visible text-gold", className)} aria-hidden>
      <motion.rect
        x="0.5"
        y="0.5"
        style={{ width: "calc(100% - 1px)", height: "calc(100% - 1px)" }}
        rx={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 0.8 }}
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        transition={{ duration: 2.2, delay, ease }}
      />
    </svg>
  );
}

/** Hand-drawn swash that sweeps in beneath a headline. */
export function Swash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 24" className={cn("w-full max-w-xs text-gold", className)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <motion.path
        d="M4 16 C 50 4, 90 22, 140 12 S 240 4, 296 14"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.8, delay: 0.4, ease }}
      />
    </svg>
  );
}
