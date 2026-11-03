"use client";

import { m as motion, useScroll, useTransform } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/**
 * Fixed screen-blended light that drifts over the whole site and shifts temperature as you scroll:
 * candle gold at the top, rosé/wine through the middle, violet near the end.
 * Pure radial gradients + transforms (no blur filters) so it stays cheap. Desktop only.
 */
export function AmbientGlow() {
  const wide = useMediaQuery("(min-width: 1024px)");
  const { scrollYProgress } = useScroll();
  const gold = useTransform(scrollYProgress, [0, 0.45, 1], [0.5, 0.18, 0.08]);
  const wine = useTransform(scrollYProgress, [0, 0.4, 0.8, 1], [0, 0.4, 0.3, 0.1]);
  const violet = useTransform(scrollYProgress, [0, 0.6, 1], [0, 0.05, 0.4]);

  if (!wide) return null;
  return (
    <div aria-hidden className="ambient-glow pointer-events-none fixed inset-0 z-[35] overflow-hidden mix-blend-screen">
      <motion.div
        style={{ opacity: gold, background: "radial-gradient(closest-side, rgba(224,178,96,0.22), transparent)" }}
        className="absolute -left-[15%] -top-[25%] h-[85vmax] w-[85vmax] [animation:drift-a_26s_ease-in-out_infinite]"
      />
      <motion.div
        style={{ opacity: wine, background: "radial-gradient(closest-side, rgba(176,64,84,0.2), transparent)" }}
        className="absolute -right-[20%] top-[10%] h-[80vmax] w-[80vmax] [animation:drift-b_32s_ease-in-out_infinite]"
      />
      <motion.div
        style={{ opacity: violet, background: "radial-gradient(closest-side, rgba(110,70,200,0.22), transparent)" }}
        className="absolute -bottom-[30%] left-[10%] h-[75vmax] w-[75vmax] [animation:drift-a_38s_ease-in-out_infinite_reverse]"
      />
    </div>
  );
}
