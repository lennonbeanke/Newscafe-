"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { gallery } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/ui/Lightbox";
import { ReelRow } from "@/components/ui/ReelRow";

interface GalleryReelProps {
  /** Two opposing rows by default; pass 1 for a single, taller row. */
  rows?: 1 | 2;
  className?: string;
}

const half = Math.ceil(gallery.length / 2);

/** Infinite, draggable reel of the gallery with the advanced lightbox. */
export function GalleryReel({ rows = 2, className }: GalleryReelProps) {
  const [open, setOpen] = useState<number | null>(null);
  const openItem = (id: string) => setOpen(gallery.findIndex((g) => g.id === id));
  const a = rows === 1 ? gallery : gallery.slice(0, half);
  const b = gallery.slice(half);

  return (
    <div className={cn("flex flex-col gap-3 md:gap-5", className)}>
      <ReelRow items={a} direction={-1} speed={0.55} onOpen={(i) => openItem(i.id)} className={rows === 1 ? "h-[46svh] min-h-[320px]" : "h-[34svh] min-h-[240px]"} />
      {rows === 2 && <ReelRow items={b} direction={1} speed={0.45} onOpen={(i) => openItem(i.id)} className="h-[34svh] min-h-[240px]" />}
      <AnimatePresence>
        {open !== null && <Lightbox key="reel-lightbox" items={gallery} startIndex={open} onClose={() => setOpen(null)} morph={false} />}
      </AnimatePresence>
    </div>
  );
}
