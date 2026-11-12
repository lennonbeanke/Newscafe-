"use client";

import { createElement, type CSSProperties, type ElementType } from "react";
import { m as motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { parseAccent } from "@/lib/text";

interface SplitRevealProps {
  text: string;
  as?: ElementType;
  className?: string;
  /** "intro" waits for the preloader; "view" fires when scrolled into view. */
  trigger?: "intro" | "view";
  /** Reveal whole words, or individual letters with a focus-pull blur. */
  by?: "word" | "char";
  delay?: number;
  stagger?: number;
  /** Words wrapped in *asterisks* render as italic gold with a hand-drawn underline. */
}

const unit: Variants = {
  hidden: { y: "118%", rotate: 5, opacity: 0, filter: "blur(10px)" },
  show: {
    y: "0%",
    rotate: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 1.2, ease: [0.16, 1, 0.3, 1] },
  },
};

const underline: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { duration: 1.4, delay: 0.9, ease: [0.65, 0, 0.35, 1] } },
};

/** Masked headline reveal. Each word (or letter) rises from behind a mask while pulling into focus. */
export function SplitReveal({ text, as = "h2", className, trigger = "view", by = "word", delay = 0, stagger }: SplitRevealProps) {
  const words = parseAccent(text);
  const plain = text.replace(/\*/g, "");
  const step = stagger ?? (by === "char" ? 0.028 : 0.08);

  // Above-the-fold headlines animate with CSS so they are visible at first paint, with no wait for hydration.
  if (trigger === "intro") {
    let n = 0;
    return createElement(
      as,
      { className: cn("display", className), "aria-label": plain },
      <span className="inline" aria-hidden>
        {words.map(({ w, accent }, wi) => (
          <span key={wi} className="relative inline-block align-bottom">
            <span className="inline-block overflow-hidden pb-[0.14em] align-bottom">
              {(by === "char" ? Array.from(w) : [w]).map((u, j) => (
                <span
                  key={j}
                  className={cn(
                    "intro-rise origin-bottom-left",
                    accent && "italic text-gold-gradient",
                    by === "word" && accent && "pr-[0.08em]",
                  )}
                  style={{ "--d": `${delay}s`, "--i": n++, "--step": `${step}s` } as CSSProperties}
                >
                  {u}
                </span>
              ))}
            </span>
            {accent && (
              <svg
                viewBox="0 0 100 10"
                className="pointer-events-none absolute -bottom-[0.06em] left-0 aspect-[10/1] w-full overflow-visible text-gold"
                fill="none"
              >
                <path
                  pathLength={1}
                  d="M1 6 C 20 1, 38 9, 58 5 S 88 2, 99 5"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  strokeLinecap="round"
                  className="intro-draw"
                  style={{ "--d": `${delay + 0.9 + n * step * 0.4}s` } as CSSProperties}
                />
              </svg>
            )}
            {"\u00A0"}
          </span>
        ))}
      </span>,
    );
  }

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };

  const motionProps = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "0px 0px -12% 0px" } };

  return createElement(
    as,
    { className: cn("display", className), "aria-label": plain },
    <motion.span variants={container} className="inline" {...motionProps} aria-hidden>
      {words.map(({ w, accent }, i) => (
        <span key={i} className="relative inline-block align-bottom">
          <span className="inline-block overflow-hidden pb-[0.14em] align-bottom">
            {by === "char" ? (
              Array.from(w).map((ch, j) => (
                <motion.span
                  key={j}
                  variants={unit}
                  className={cn("inline-block origin-bottom-left", accent && "italic text-gold-gradient")}
                >
                  {ch}
                </motion.span>
              ))
            ) : (
              <motion.span
                variants={unit}
                className={cn("inline-block origin-bottom-left", accent && "italic text-gold-gradient pr-[0.08em]")}
              >
                {w}
              </motion.span>
            )}
          </span>
          {accent && (
            <svg
              viewBox="0 0 100 10"
              className="pointer-events-none absolute -bottom-[0.06em] left-0 aspect-[10/1] w-full overflow-visible text-gold"
              fill="none"
            >
              <motion.path
                d="M1 6 C 20 1, 38 9, 58 5 S 88 2, 99 5"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeLinecap="round"
                variants={underline}
              />
            </svg>
          )}
          {" "}
        </span>
      ))}
    </motion.span>,
  );
}
