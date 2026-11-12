"use client";

import type { ReactNode } from "react";
import { m as motion } from "framer-motion";
import { useMagnetic } from "@/hooks/useMagnetic";

/** Wraps any inline control so it leans toward the cursor. */
export function Magnetic({ children, className, strength = 0.35 }: { children: ReactNode; className?: string; strength?: number }) {
  const { ref, style, bind } = useMagnetic(strength, strength);
  return (
    <motion.div ref={ref} style={style} {...bind} className={className ?? "inline-block"}>
      {children}
    </motion.div>
  );
}
