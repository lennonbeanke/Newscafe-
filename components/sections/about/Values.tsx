"use client";

import { m as motion, type Variants } from "framer-motion";
import type { PointerEvent } from "react";
import { SectionHeading } from "@/components/ui/SectionHeading";

const values = [
  { n: "01", t: "Good food", d: "New flavours. New favourites. From the breakfast menu to the new summer food menu." },
  { n: "02", t: "Great cocktails", d: "A classic double, the Orchid Mist cocktail, or whatever the night deserves." },
  { n: "03", t: "Unmistakable atmosphere", d: "Somewhere between golden hour and one more round. It's all about the vibe." },
];

const wrap: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.15 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 70 },
  show: { opacity: 1, y: 0, transition: { duration: 1.1, ease: [0.16, 1, 0.3, 1] } },
};

function spotlight(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Values() {
  return (
    <section className="py-28 md:py-44">
      <div className="container-x">
        <SectionHeading eyebrow="What it's about" title="Three things we *stand for*" className="mb-20" />
        <motion.ul variants={wrap} initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -15% 0px" }} className="grid gap-6 md:grid-cols-3">
          {values.map((v) => (
            <motion.li
              key={v.n}
              variants={card}
              onPointerMove={spotlight}
              className="glass group relative overflow-hidden rounded-3xl p-8 md:p-10"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{ background: "radial-gradient(360px circle at var(--mx,50%) var(--my,50%), rgba(201,164,92,0.18), transparent 60%)" }}
              />
              <p className="display text-7xl text-gold/40 transition-colors duration-500 group-hover:text-gold">{v.n}</p>
              <h3 className="display mt-24 text-4xl md:text-5xl">{v.t}</h3>
              <p className="mt-4 text-bone/65">{v.d}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
