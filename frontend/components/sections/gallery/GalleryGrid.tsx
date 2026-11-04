"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, m as motion } from "framer-motion";
import { gallery } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useColumns } from "@/hooks/useColumns";
import { Lightbox } from "@/components/ui/Lightbox";
import { Distort } from "@/components/ui/Distort";
import type { GalleryCategory, GalleryItem } from "@/types";

const filters: ("All" | GalleryCategory)[] = ["All", "Venue", "Cocktails", "Food", "Nights"];

/** Place each tile in the currently shortest column so the masonry stays balanced. */
function distribute(items: GalleryItem[], count: number) {
  const cols: GalleryItem[][] = Array.from({ length: count }, () => []);
  const heights = Array(count).fill(0);
  items.forEach((item) => {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].push(item);
    heights[i] += 1 / item.ratio;
  });
  return cols;
}

export function GalleryGrid() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [open, setOpen] = useState<number | null>(null);
  const columnCount = useColumns();

  const shown = useMemo(() => gallery.filter((g) => filter === "All" || g.category === filter), [filter]);
  const columns = useMemo(() => distribute(shown, columnCount), [shown, columnCount]);

  return (
    <section className="py-20 md:py-32">
      <div className="container-x">
        <div className="mb-14 flex flex-wrap items-center justify-center gap-3">
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
              {filter === f && <motion.span layoutId="gallery-filter" className="absolute inset-0 rounded-full bg-gold" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
              <span className="relative z-10">{f}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-3 md:gap-5">
          {columns.map((col, c) => (
            <div key={c} className="flex flex-1 flex-col gap-3 md:gap-5">
              {col.map((item, r) => {
                const index = shown.findIndex((s) => s.id === item.id);
                return (
                  <motion.figure
                    key={item.id}
                    layoutId={`g-${item.id}`}
                    initial={{ opacity: 0, y: 70, scale: 0.94 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true, margin: "0px 0px -8% 0px" }}
                    transition={{ duration: 1, delay: (r % 3) * 0.08 + c * 0.06, ease: [0.16, 1, 0.3, 1] }}
                    className="theme-dark group relative cursor-pointer overflow-hidden rounded-2xl"
                    style={{ aspectRatio: item.ratio }}
                    data-cursor="View"
                  >
                    <button className="absolute inset-0 z-10" onClick={() => setOpen(index)} aria-label={`Open: ${item.alt}`} />
                    <Distort className="absolute inset-0">
                      <Image
                        src={item.src}
                        alt={item.alt}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition-transform duration-[1400ms] ease-lux group-hover:scale-110"
                      />
                    </Distort>
                    <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
                    <figcaption className="absolute inset-x-0 bottom-0 translate-y-4 p-5 opacity-0 transition-all duration-700 ease-lux group-hover:translate-y-0 group-hover:opacity-100">
                      <span className="eyebrow text-[0.6rem]">{item.category}</span>
                    </figcaption>
                  </motion.figure>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {open !== null && <Lightbox key="lightbox" items={shown} startIndex={open} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </section>
  );
}
