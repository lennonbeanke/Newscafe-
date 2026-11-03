"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, m as motion, useMotionValue, useSpring } from "framer-motion";
import { FiArrowUpRight } from "react-icons/fi";
import { events } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/ui/Reveal";
import type { EventKind } from "@/types";

const filters: ("All" | EventKind)[] = ["All", "Promo", "Menu", "Bar", "Functions"];

export function EventsList() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [hovered, setHovered] = useState<string | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 140, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 140, damping: 18, mass: 0.5 });
  const rotate = useSpring(0, { stiffness: 120, damping: 14 });

  const visible = events.filter((e) => filter === "All" || e.kind === filter);
  const preview = events.find((e) => e.id === hovered);

  return (
    <section className="relative py-24 md:py-36" onPointerMove={(e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      rotate.set(Math.max(-8, Math.min(8, e.movementX * 0.6)));
    }}>
      <div className="container-x">
        <div className="mb-14 flex flex-wrap items-center gap-3">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "relative rounded-full border px-6 py-3 text-[0.7rem] font-semibold uppercase tracking-[0.2em] transition-colors duration-500",
                filter === f ? "border-gold text-ink" : "border-line text-bone/70 hover:border-gold/60 hover:text-gold-light",
              )}
            >
              {filter === f && <motion.span layoutId="event-filter" className="absolute inset-0 rounded-full bg-gold" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
              <span className="relative z-10">{f}</span>
            </button>
          ))}
        </div>

        <ul className="border-t border-line">
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((e, i) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                onPointerEnter={() => setHovered(e.id)}
                onPointerLeave={() => setHovered(null)}
                className="group relative border-b border-line"
              >
                <span aria-hidden className="absolute inset-0 origin-bottom scale-y-0 bg-gold/[0.06] transition-transform duration-700 ease-lux group-hover:scale-y-100" />
                <div className="relative grid grid-cols-12 items-center gap-4 py-8 md:py-12">
                  <div className="col-span-3 md:col-span-2">
                    <p className="display text-5xl text-gold md:text-6xl">{e.day}</p>
                    <p className="mt-1 text-[0.62rem] uppercase tracking-[0.25em] text-mist">{e.month}</p>
                  </div>
                  <div className="col-span-9 md:col-span-6">
                    <h2 className="display text-4xl transition-transform duration-700 ease-lux group-hover:translate-x-3 md:text-6xl">{e.title}</h2>
                    <p className="mt-3 max-w-xl text-bone/60">{e.blurb}</p>
                  </div>
                  <div className="col-span-9 col-start-4 flex items-center justify-between gap-4 md:col-span-4 md:col-start-9">
                    <div>
                      <span className="rounded-full border border-gold/50 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-gold-light">{e.kind}</span>
                    </div>
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line transition-all duration-500 group-hover:rotate-45 group-hover:border-gold group-hover:bg-gold group-hover:text-ink">
                      <FiArrowUpRight size={22} />
                    </span>
                  </div>
                  {/* Mobile thumbnail */}
                  <div className="relative col-span-12 mt-2 aspect-[16/9] overflow-hidden rounded-2xl md:hidden">
                    <Image src={e.image} alt={e.title} fill sizes="100vw" className="object-cover" />
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      {/* Cursor-following preview (desktop, fine pointers) */}
      <div className="pointer-events-none fixed left-0 top-0 z-40 hidden md:block">
        <motion.div style={{ x: sx, y: sy, rotate, translateX: "-50%", translateY: "-50%" }}>
          <AnimatePresence>
            {preview && (
              <motion.div
                key={preview.id}
                initial={{ opacity: 0, scale: 0.6, clipPath: "inset(50% 50% 50% 50%)" }}
                animate={{ opacity: 1, scale: 1, clipPath: "inset(0% 0% 0% 0%)" }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="relative h-72 w-56 overflow-hidden rounded-2xl shadow-2xl shadow-black/60"
              >
                <Image src={preview.image} alt="" fill sizes="224px" className="object-cover" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <Reveal className="container-x mt-16">
        <p className="text-sm text-mist">Follow us on Instagram for the latest promos. To book a function, email info@newscafe.co.za.</p>
      </Reveal>
    </section>
  );
}
