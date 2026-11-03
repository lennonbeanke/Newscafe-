"use client";

import { type ReactNode, type PointerEvent, useRef } from "react";
import { m as motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Max rotation in degrees. */
  max?: number;
}

/**
 * 3D hover: the card tilts toward the pointer under perspective, a specular glare tracks the cursor,
 * and descendants can read --px / --py (-1…1) to counter-shift for parallax depth.
 */
export function TiltCard({ children, className, max = 9 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const rotateY = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const rotateX = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const sx = useSpring(px, { stiffness: 140, damping: 20 });
  const sy = useSpring(py, { stiffness: 140, damping: 20 });
  const glare = useMotionTemplate`radial-gradient(520px circle at ${gx}% ${gy}%, rgba(255,246,222,0.2), transparent 55%)`;

  const move = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    rotateY.set((nx - 0.5) * 2 * max);
    rotateX.set(-(ny - 0.5) * 2 * max);
    px.set((nx - 0.5) * 2);
    py.set((ny - 0.5) * 2);
    gx.set(nx * 100);
    gy.set(ny * 100);
  };
  const leave = () => {
    rotateX.set(0);
    rotateY.set(0);
    px.set(0);
    py.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ rotateX, rotateY, transformPerspective: 1100, "--px": sx, "--py": sy } as never}
      className={cn("group/tilt relative will-change-transform", className)}
    >
      {children}
      <motion.span
        aria-hidden
        style={{ background: glare }}
        className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] opacity-0 mix-blend-soft-light transition-opacity duration-500 group-hover/tilt:opacity-100"
      />
    </motion.div>
  );
}
