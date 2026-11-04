"use client";

import type { ReactNode } from "react";
import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  variant?: "up" | "scale" | "blur" | "left" | "right";
  once?: boolean;
}

const hidden = {
  up: (y: number) => ({ opacity: 0, y }),
  scale: () => ({ opacity: 0, scale: 0.92 }),
  blur: () => ({ opacity: 0, filter: "blur(16px)", y: 20 }),
  left: () => ({ opacity: 0, x: -60 }),
  right: () => ({ opacity: 0, x: 60 }),
};

/** Scroll-triggered fade with directional / scale / blur flavours. */
export function Reveal({ children, className, delay = 0, y = 48, variant = "up", once = true }: RevealProps) {
  return (
    <motion.div
      className={cn(className)}
      initial={hidden[variant](y)}
      whileInView={{ opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
