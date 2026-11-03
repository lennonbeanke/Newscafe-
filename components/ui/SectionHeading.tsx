"use client";

import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SplitReveal } from "./SplitReveal";

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  align?: "left" | "center";
  className?: string;
  as?: "h1" | "h2";
  children?: React.ReactNode;
}

export function SectionHeading({ eyebrow, title, align = "left", className, as = "h2", children }: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-6", align === "center" && "items-center text-center", className)}>
      <div className="flex items-center gap-4">
        <motion.span
          className="h-px w-12 origin-left bg-gold"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <span className="eyebrow">{eyebrow}</span>
      </div>
      <SplitReveal as={as} text={title} className="text-5xl md:text-7xl lg:text-8xl" />
      {children}
    </div>
  );
}
