"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "framer-motion";

// Framer's animation engine is fetched as its own chunk after hydration instead of shipping in the main bundle.
// All components use the lightweight `m` primitives; `strict` makes any stray full `motion` import throw.
const loadFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);

/** Users who prefer reduced motion get fades only: Framer disables transform/layout animation globally. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
