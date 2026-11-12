"use client";

import { useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Common = { label: string; className?: string };
type InputProps = Common & { as?: "input" } & InputHTMLAttributes<HTMLInputElement>;
type AreaProps = Common & { as: "textarea" } & TextareaHTMLAttributes<HTMLTextAreaElement>;
type SelectProps = Common & { as: "select"; options: string[] } & InputHTMLAttributes<HTMLSelectElement>;

/** Floating-label field with a gold underline that draws in on focus. */
export function Field(props: InputProps | AreaProps | SelectProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [filled, setFilled] = useState(false);
  const { label, className, as = "input", ...rest } = props as Common & { as?: string } & Record<string, unknown>;
  const lifted = focused || filled || as === "select" || rest.type === "date";

  const shared = {
    id,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: { target: { value: string } }) => setFilled(e.target.value.length > 0),
    className: "peer w-full bg-transparent pb-3 pt-7 text-lg text-bone outline-none placeholder:text-transparent",
  };

  return (
    <div className={cn("relative", className)}>
      {as === "textarea" ? (
        <textarea rows={4} {...shared} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} placeholder=" " />
      ) : as === "select" ? (
        <select {...shared} {...(rest as Record<string, unknown>)}>
          {(props as SelectProps).options.map((o) => (
            <option key={o} value={o} className="bg-onyx">{o}</option>
          ))}
        </select>
      ) : (
        <input {...shared} {...(rest as InputHTMLAttributes<HTMLInputElement>)} placeholder=" " />
      )}
      <motion.label
        htmlFor={id}
        className={cn("pointer-events-none absolute left-0 origin-left transition-colors duration-300", focused ? "text-gold" : "text-mist")}
        animate={{ y: lifted ? 0 : 26, scale: lifted ? 0.72 : 1 }}
        initial={false}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        style={{ top: 4 }}
      >
        {label}
      </motion.label>
      <span className="absolute inset-x-0 bottom-0 h-px bg-line" />
      <motion.span
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-gold"
        initial={false}
        animate={{ scaleX: focused ? 1 : 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}
