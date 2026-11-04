"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m as motion, useMotionValue, useSpring, useTransform, useVelocity } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * Gold follower cursor for fine pointers.
 * - stretches and rotates with velocity (squash-and-stretch)
 * - grows and shows a label over elements with data-cursor="Label"
 * - feeds --mx/--my to the nearest .glass surface so panels catch light under the pointer
 */
export function Cursor() {
  const enabled = useMediaQuery("(pointer: fine)");
  const [label, setLabel] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 520, damping: 42, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 520, damping: 42, mass: 0.35 });
  const vx = useVelocity(sx);
  const vy = useVelocity(sy);
  const stretchX = useTransform([vx, vy], ([a, b]: number[]) => 1 + Math.min(Math.hypot(a, b) / 2400, 0.7));
  const stretchY = useTransform([vx, vy], ([a, b]: number[]) => 1 - Math.min(Math.hypot(a, b) / 6500, 0.3));
  const angle = useTransform([vx, vy], ([a, b]: number[]) => (Math.hypot(a, b) > 80 ? (Math.atan2(b, a) * 180) / Math.PI : 0));
  const sStretchX = useSpring(stretchX, { stiffness: 300, damping: 24 });
  const sStretchY = useSpring(stretchY, { stiffness: 300, damping: 24 });

  useEffect(() => {
    if (!enabled) return;
    let px = -100;
    let py = -100;
    let glass: HTMLElement | null = null;

    const resolve = (target: Element | null) => {
      const el = target?.closest<HTMLElement>("[data-cursor]");
      setLabel(el ? el.dataset.cursor || "" : null);
    };
    const light = (target: Element | null) => {
      const g = target?.closest<HTMLElement>(".glass") ?? null;
      if (glass && glass !== g) {
        glass.style.removeProperty("--mx");
        glass.style.removeProperty("--my");
      }
      glass = g;
      if (g) {
        const r = g.getBoundingClientRect();
        g.style.setProperty("--mx", `${px - r.left}px`);
        g.style.setProperty("--my", `${py - r.top}px`);
      }
    };
    const move = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      x.set(px);
      y.set(py);
      resolve(e.target as Element | null);
      light(e.target as Element | null);
    };
    // Content can change under a stationary pointer (lightbox opens, page transitions).
    const recheck = window.setInterval(() => {
      if (px >= 0) resolve(document.elementFromPoint(px, py));
    }, 400);
    const down = () => setPressed(true);
    const up = () => setPressed(false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.clearInterval(recheck);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;
  const big = label !== null;
  const size = big ? (label ? 92 : 64) : 14;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[120] hidden md:block"
      style={{ x: sx, y: sy }}
    >
      <motion.div
        className="absolute rounded-full border border-gold/70"
        style={{ translateX: "-50%", translateY: "-50%", rotate: angle, scaleX: sStretchX, scaleY: sStretchY }}
        animate={{
          width: size,
          height: size,
          backgroundColor: big ? "rgba(201,164,92,0.92)" : "rgba(201,164,92,0.22)",
          boxShadow: big ? "0 0 40px rgba(201,164,92,0.5)" : "0 0 0px rgba(201,164,92,0)",
          scale: pressed ? 0.85 : 1,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      />
      <div className="absolute flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        <AnimatePresence>
          {label ? (
            <motion.span
              key={label}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-ink"
            >
              {label}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
