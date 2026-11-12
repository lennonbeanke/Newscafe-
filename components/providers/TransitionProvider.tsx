"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { m as motion } from "framer-motion";
import { TransitionContext } from "@/hooks/useTransitionNav";
import { site } from "@/lib/site";

type Phase = "idle" | "in" | "out";

const COVER_MS = 750;

/**
 * Curtain page transition: the curtain rises over the page, the route changes underneath,
 * then the curtain lifts away to reveal the new page.
 */
export function TransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const target = useRef<string | null>(null);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const navigate = useCallback(
    (href: string) => {
      if (phaseRef.current !== "idle") return;
      const path = href.split("#")[0].split("?")[0] || "/";
      if (path === pathname) return;
      target.current = path;
      setPhase("in");
      window.setTimeout(() => router.push(href), COVER_MS);
      // Safety net: never leave the curtain stuck if navigation fails.
      window.setTimeout(() => {
        if (phaseRef.current === "in") setPhase("out");
      }, 6000);
    },
    [pathname, router],
  );

  useEffect(() => {
    if (target.current && pathname === target.current) {
      target.current = null;
      const id = window.setTimeout(() => setPhase("out"), 250);
      return () => window.clearTimeout(id);
    }
  }, [pathname]);

  return (
    <TransitionContext.Provider value={{ navigate }}>
      {children}
      <motion.div
        aria-hidden
        initial={false}
        animate={
          phase === "in"
            ? { y: "0%", transition: { duration: 0.75, ease: [0.76, 0, 0.24, 1] } }
            : phase === "out"
              ? { y: "-100%", transition: { duration: 0.9, ease: [0.76, 0, 0.24, 1] } }
              : { y: "100%", transition: { duration: 0 } }
        }
        onAnimationComplete={() => {
          if (phaseRef.current === "out") setPhase("idle");
        }}
        className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-onyx"
        style={{ pointerEvents: phase === "idle" ? "none" : "auto" }}
      >
        <div className="flex flex-col items-center gap-5">
          <span className="display text-4xl tracking-[0.25em] text-gold-gradient md:text-6xl">
            {site.name.toUpperCase()}
          </span>
          <motion.span
            className="h-px w-24 origin-left bg-gold"
            animate={{ scaleX: phase === "in" ? [0, 1] : 1 }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </TransitionContext.Provider>
  );
}
