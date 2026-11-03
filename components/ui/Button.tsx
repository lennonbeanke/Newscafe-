"use client";

import type { ReactNode } from "react";
import { m as motion } from "framer-motion";
import { useMagnetic } from "@/hooks/useMagnetic";
import { cn } from "@/lib/utils";
import { TransitionLink } from "./TransitionLink";

interface ButtonProps {
  href: string;
  children: ReactNode;
  variant?: "gold" | "glass" | "ghost";
  className?: string;
  external?: boolean;
  onClick?: () => void;
}

const base =
  "group relative inline-flex items-center justify-center overflow-hidden rounded-full px-8 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.22em] transition-colors duration-500";

const variants = {
  gold: "sheen sheen-auto bg-gold text-ink hover:shadow-[0_0_48px_-6px_rgba(201,164,92,0.75)]",
  glass: "glass sheen text-bone",
  ghost: "border border-line text-bone hover:border-gold",
};

/** Pill button with magnetic pull toward the cursor and a liquid fill on hover. */
export function Button({ href, children, variant = "gold", className, external, onClick }: ButtonProps) {
  const { ref, style, bind } = useMagnetic();

  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 translate-y-full rounded-[50%_50%_0_0/100%_100%_0_0] transition-all duration-500 ease-lux group-hover:translate-y-0 group-hover:rounded-none",
          variant === "gold" ? "bg-bone" : "bg-gold",
        )}
      />
      <span
        className={cn(
          "relative z-10 flex items-center gap-3 transition-colors duration-500",
          variant !== "gold" && "group-hover:text-ink",
        )}
      >
        {children}
      </span>
    </>
  );
  const cls = cn(base, variants[variant], className);

  return (
    <motion.div
      ref={ref}
      {...bind}
      style={style}
      className="inline-block"
    >
      {external ? (
        <a href={href} className={cls} target="_blank" rel="noopener noreferrer" onClick={onClick}>
          {inner}
        </a>
      ) : /^(mailto:|tel:)/.test(href) ? (
        <a href={href} className={cls} onClick={onClick}>
          {inner}
        </a>
      ) : (
        <TransitionLink href={href} className={cls} onClick={onClick}>
          {inner}
        </TransitionLink>
      )}
    </motion.div>
  );
}
