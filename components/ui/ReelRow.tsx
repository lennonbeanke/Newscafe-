"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { getLenis } from "@/lib/lenis";
import { cn } from "@/lib/utils";
import type { GalleryItem } from "@/types";

interface ReelRowProps {
  items: GalleryItem[];
  /** 1 drifts right, -1 drifts left. */
  direction?: 1 | -1;
  /** Idle drift in px per 60fps frame. */
  speed?: number;
  onOpen: (item: GalleryItem) => void;
  className?: string;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Infinite horizontal gallery row.
 * - drifts on its own; page-scroll velocity (Lenis) accelerates it and skews it
 * - drag / flick with real momentum, wheel-pan on trackpads
 * - seamless loop (content rendered twice, position wrapped at half width)
 */
export function ReelRow({ items, direction = -1, speed = 0.5, onOpen, className }: ReelRowProps) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const moved = useRef(0);

  useEffect(() => {
    const el = track.current;
    const wrap = box.current;
    if (!el || !wrap) return;

    let x = 0;
    let vel = 0;
    let half = 0;
    let dragging = false;
    let lastX = 0;
    let visible = false;
    const base = reduce ? 0 : speed * direction;

    const measure = () => {
      half = el.scrollWidth / 2;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "200px" });
    io.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const deltaMs = now - last;
      last = now;
      if (!visible || !half) return;
      const dt = Math.min(deltaMs, 50) / 16.667;
      if (!dragging) {
        const sv = reduce ? 0 : (getLenis()?.velocity ?? 0);
        const target = base + sv * 0.22 * direction;
        vel += (target - vel) * 0.032 * dt; // slow ease back to cruising speed = momentum
      }
      x += vel * dt;
      if (x <= -half) x += half;
      else if (x > 0) x -= half;
      const skew = reduce ? 0 : clamp(vel * 0.45, -8, 8);
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,0) skewX(${(-skew).toFixed(2)}deg)`;
    };
    raf = requestAnimationFrame(tick);

    // Pointer capture starts only after a real drag begins; capturing on pointerdown would
    // retarget the click away from the photo's button and make items impossible to open.
    let pressed = false;
    let captured = false;
    const down = (e: PointerEvent) => {
      pressed = true;
      captured = false;
      moved.current = 0;
      lastX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved.current += Math.abs(dx);
      if (!captured && moved.current > 5) {
        captured = true;
        dragging = true;
        wrap.setPointerCapture(e.pointerId);
        wrap.style.cursor = "grabbing";
      }
      if (dragging) {
        x += dx;
        vel = clamp(dx, -55, 55);
      }
    };
    const up = (e: PointerEvent) => {
      pressed = false;
      if (!dragging) return;
      dragging = false;
      if (captured) wrap.releasePointerCapture?.(e.pointerId);
      wrap.style.cursor = "";
    };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) vel -= e.deltaX * 0.12;
    };
    wrap.addEventListener("pointerdown", down);
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("wheel", wheel, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      wrap.removeEventListener("pointerdown", down);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", up);
      wrap.removeEventListener("wheel", wheel);
    };
  }, [direction, speed, reduce]);

  const row = (hidden: boolean) =>
    items.map((item) => (
      <figure
        key={`${hidden ? "b" : "a"}-${item.id}`}
        aria-hidden={hidden || undefined}
        className="theme-dark group relative h-full shrink-0 overflow-hidden rounded-2xl"
        style={{ aspectRatio: item.ratio }}
      >
        <button
          tabIndex={hidden ? -1 : 0}
          className="absolute inset-0 z-10"
          aria-label={`Open: ${item.alt}`}
          onClickCapture={(e) => {
            if (moved.current > 6) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={() => onOpen(item)}
        />
        <Image
          src={item.src}
          alt={hidden ? "" : item.alt}
          fill
          draggable={false}
          sizes="(min-width: 1024px) 30vw, 60vw"
          className="pointer-events-none object-cover transition-transform duration-[1200ms] ease-lux group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
        <figcaption className="absolute inset-x-0 bottom-0 translate-y-3 p-4 opacity-0 transition-all duration-700 ease-lux group-hover:translate-y-0 group-hover:opacity-100">
          <span className="eyebrow text-[0.6rem]">{item.category}</span>
        </figcaption>
      </figure>
    ));

  return (
    <div ref={box} data-cursor="Drag" className={cn("select-none overflow-hidden [touch-action:pan-y]", className)}>
      <div ref={track} className="flex h-full w-max gap-3 will-change-transform md:gap-5">
        <div className="flex h-full gap-3 md:gap-5">{row(false)}</div>
        <div className="flex h-full gap-3 md:gap-5">{row(true)}</div>
      </div>
    </div>
  );
}
