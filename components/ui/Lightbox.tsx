"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, m as motion, type PanInfo } from "framer-motion";
import { FiArrowLeft, FiArrowRight, FiMinus, FiPlus, FiX } from "react-icons/fi";
import { lockScroll, unlockScroll } from "@/lib/lenis";
import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/types";

interface LightboxProps {
  items: GalleryItem[];
  startIndex: number;
  onClose: () => void;
  /** Morph the first image out of its grid tile (shared layoutId). Off when opened from the reel. */
  morph?: boolean;
}

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 180, rotateY: dir * -14, scale: 0.92, filter: "blur(16px)" }),
  center: { opacity: 1, x: 0, rotateY: 0, scale: 1, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, x: dir * -180, rotateY: dir * 14, scale: 0.92, filter: "blur(16px)" }),
};

const GRID_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/**
 * Full-screen viewer:
 * - first image morphs from its tile; later ones slide in 3D with a focus-pull
 * - ambient glow sampled from the photograph itself
 * - click to zoom, pointer pans the zoomed image
 * - filmstrip, keyboard, swipe left/right to navigate, swipe down to dismiss
 */
export function Lightbox({ items, startIndex, onClose, morph = true }: LightboxProps) {
  const [[index, dir], setPage] = useState<[number, number]>([startIndex, 0]);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const strip = useRef<HTMLDivElement>(null);
  const item = items[index];
  const frameStyle = { aspectRatio: item.ratio, width: `min(90vw, calc(76svh * ${item.ratio}))` };

  const go = useCallback(
    (d: number) => {
      setZoom(false);
      setPage(([i]) => [(i + d + items.length) % items.length, d]);
    },
    [items.length],
  );
  const jump = (i: number) => {
    setZoom(false);
    setPage(([cur]) => [i, i > cur ? 1 : -1]);
  };

  useEffect(() => {
    lockScroll();
    return () => unlockScroll();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoom) setZoom(false);
        else onClose();
      }
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " " || e.key.toLowerCase() === "z") {
        e.preventDefault();
        setZoom((z) => !z);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, zoom]);

  // Keep the active thumbnail centred in the filmstrip.
  useEffect(() => {
    const el = strip.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { x, y } = info.offset;
    if (Math.abs(y) > 120 && Math.abs(y) > Math.abs(x)) onClose();
    else if (x < -90) go(1);
    else if (x > 90) go(-1);
  };

  const first = dir === 0;
  const sharedId = morph && first ? `g-${item.id}` : undefined;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="theme-dark fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-ink/95"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      onClick={onClose}
    >
      {/* Ambient glow: a heavily blurred copy of the current photo tints the whole room */}
      <AnimatePresence initial={false}>
        <motion.div
          key={item.id}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          <Image src={item.src} alt="" fill sizes="20vw" className="scale-125 object-cover blur-[70px] saturate-150" />
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(6,6,6,0.7)_100%)]" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5 md:p-8" onClick={(e) => e.stopPropagation()}>
        <p className="font-mono text-xs tracking-[0.3em] text-bone/70">
          {String(index + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
        </p>
        <div className="flex gap-3">
          <button onClick={() => setZoom((z) => !z)} aria-label={zoom ? "Zoom out" : "Zoom in"} className="glass flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:bg-gold hover:text-ink">
            {zoom ? <FiMinus size={18} /> : <FiPlus size={18} />}
          </button>
          <button onClick={onClose} aria-label="Close" className="glass flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-500 hover:rotate-90">
            <FiX size={20} />
          </button>
        </div>
      </div>

      {/* Stage */}
      <motion.div
        className="relative z-[5] flex items-center justify-center [perspective:1400px]"
        drag={zoom ? false : true}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.35}
        onDragEnd={onDragEnd}
        onClick={(e) => e.stopPropagation()}
      >
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={item.id}
            custom={dir}
            variants={first ? undefined : slide}
            initial={first ? false : "enter"}
            animate="center"
            exit="exit"
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              layoutId={sharedId}
              className={cn("relative overflow-hidden rounded-2xl shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
              style={frameStyle}
              initial={!morph && first ? { opacity: 0, scale: 0.88, clipPath: "inset(14% 14% 14% 14% round 28px)" } : undefined}
              animate={!morph && first ? { opacity: 1, scale: 1, clipPath: "inset(0% 0% 0% 0% round 16px)" } : undefined}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => setZoom((z) => !z)}
              onPointerMove={(e) => {
                if (!zoom) return;
                const r = e.currentTarget.getBoundingClientRect();
                setOrigin({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
              }}
              data-cursor={zoom ? "Out" : "Zoom"}
            >
              <motion.div
                className="absolute inset-0"
                animate={{ scale: zoom ? 2.3 : 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 22 }}
                style={{ transformOrigin: `${origin.x}% ${origin.y}%` }}
              >
                {/* Same sizes as the grid tile => already cached, so the morph is never empty */}
                <Image src={item.src} alt="" aria-hidden fill sizes={GRID_SIZES} className="pointer-events-none object-cover" />
                <Image
                  src={item.src}
                  alt={item.alt}
                  fill
                  sizes="(min-width: 1024px) 1400px, 100vw"
                  priority
                  onLoad={() => setLoaded((l) => ({ ...l, [item.id]: true }))}
                  className={cn("pointer-events-none object-cover transition-opacity duration-700", loaded[item.id] ? "opacity-100" : "opacity-0")}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Side arrows (desktop) */}
      <button onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous image" className="glass absolute left-5 top-1/2 z-10 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-gold hover:text-ink md:flex">
        <FiArrowLeft size={20} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next image" className="glass absolute right-5 top-1/2 z-10 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-gold hover:text-ink md:flex">
        <FiArrowRight size={20} />
      </button>

      {/* Caption + filmstrip */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 p-5 md:p-7" onClick={(e) => e.stopPropagation()}>
        <AnimatePresence mode="wait">
          <motion.p
            key={item.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45 }}
            className="max-w-xl text-center text-sm text-bone/75"
          >
            <span className="eyebrow mr-3">{item.category}</span>
            {item.alt}
          </motion.p>
        </AnimatePresence>
        <div ref={strip} className="no-scrollbar hidden max-w-[90vw] gap-2 overflow-x-auto px-2 py-1 md:flex" data-lenis-prevent>
          {items.map((t, i) => (
            <button
              key={t.id}
              onClick={() => jump(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "relative h-12 w-16 shrink-0 overflow-hidden rounded-md transition-all duration-500",
                i === index ? "scale-110 opacity-100 ring-1 ring-gold" : "opacity-40 hover:opacity-80",
              )}
            >
              <Image src={t.src} alt="" fill sizes="64px" loading="eager" className="object-cover" />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
