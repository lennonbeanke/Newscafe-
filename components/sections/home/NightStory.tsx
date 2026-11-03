"use client";

import { useRef } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { photo, type PhotoKey } from "@/lib/images";
import { cn } from "@/lib/utils";
import { useGsap } from "@/hooks/useGsap";

interface Scene {
  time: string;
  label: string;
  title: string;
  text: string;
  image: PhotoKey;
  tint: string;
}

const scenes: Scene[] = [
  {
    time: "01",
    label: "Breakfast",
    title: "Start the day right",
    text: "Slow mornings begin with the breakfast menu. Good food, good company and an easy start.",
    image: "shared",
    tint: "rgba(224,170,90,0.32)",
  },
  {
    time: "02",
    label: "Food",
    title: "New flavours. New favourites.",
    text: "Our new food menu is live and summer at News Cafe is looking delicious. Come find your new favourites.",
    image: "plated",
    tint: "rgba(190,100,55,0.36)",
  },
  {
    time: "03",
    label: "Rush Hour",
    title: "Golden hour & one more round",
    text: "Somewhere between golden hour and one more round. That's where you'll find us.",
    image: "terrace",
    tint: "rgba(224,140,70,0.4)",
  },
  {
    time: "04",
    label: "Cocktails",
    title: "The full treatment",
    text: "When the night deserves the full treatment, choose a classic double or the Orchid Mist cocktail.",
    image: "bartender",
    tint: "rgba(130,60,170,0.42)",
  },
];

const ARC = "M10 150 C 90 -34, 310 -34, 390 150";

function Static() {
  return (
    <section className="bg-ink py-24">
      <div className="container-x">
        <p className="eyebrow mb-4">A day at News Cafe</p>
        <h2 className="display mb-14 text-5xl md:text-7xl">From breakfast to the last round</h2>
        <ul className="grid gap-10 md:grid-cols-2">
          {scenes.map((s) => (
            <li key={s.time} className="overflow-hidden rounded-3xl border border-line">
              <div className="relative aspect-[16/10]">
                <Image src={photo(s.image, 1200)} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
              </div>
              <div className="p-6">
                <p className="eyebrow">
                  {s.time} · {s.label}
                </p>
                <h3 className="display mt-2 text-3xl">{s.title}</h3>
                <p className="mt-2 text-bone/65">{s.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Pinned scroll-driven story, "a day at News Cafe". As you scroll, the scene counter advances, the photograph
 * and the colour grade cross-dissolve scene to scene, copy swaps, and a sun/moon arc draws itself.
 */
export function NightStory() {
  const reduce = useReducedMotion();
  const root = useRef<HTMLElement>(null);

  useGsap(root, (gsap) => {
    if (reduce) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const q = gsap.utils.selector(root.current);
      const mobile = window.innerWidth < 768;
      const n = scenes.length;
      const clock = q(".ns-clock")[0] as HTMLElement;
      const arc = root.current?.querySelector<SVGPathElement>(".ns-arc") ?? null;
      const dot = root.current?.querySelector<SVGCircleElement>(".ns-dot") ?? null;
      const len = arc?.getTotalLength() ?? 0;
      if (arc) gsap.set(arc, { strokeDasharray: len, strokeDashoffset: len });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: `+=${mobile ? 360 : 520}%`,
          scrub: 0.9,
          pin: true,
          anticipatePin: 1,
        },
      });

      // Time of day + arc progress share one clock.
      const state = { t: 0 };
      tl.to(
        state,
        {
          t: n,
          duration: n,
          onUpdate: () => {
            const idx = Math.min(n, Math.floor(state.t) + 1);
            clock.textContent = `${String(idx).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
            if (arc && dot) {
              const p = state.t / n;
              arc.style.strokeDashoffset = String(len * (1 - p));
              const pt = arc.getPointAtLength(len * p);
              dot.setAttribute("cx", String(pt.x));
              dot.setAttribute("cy", String(pt.y));
            }
          },
        },
        0,
      );

      tl.to(q(".ns-parallax"), { yPercent: -8, duration: n }, 0);

      scenes.forEach((_, i) => {
        if (i > 0) {
          tl.fromTo(
            q(`.ns-img-${i}`),
            { opacity: 0, scale: 1.18, filter: "blur(18px)" },
            { opacity: 1, scale: 1.02, filter: "blur(0px)", duration: 0.7 },
            i - 0.35,
          );
          tl.fromTo(q(`.ns-tint-${i}`), { opacity: 0 }, { opacity: 1, duration: 0.7 }, i - 0.35);
        }
        tl.fromTo(
          q(`.ns-text-${i}`),
          { opacity: 0, y: 70, filter: "blur(10px)" },
          { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.35 },
          i === 0 ? 0 : i - 0.1,
        );
        if (i < n - 1) tl.to(q(`.ns-text-${i}`), { opacity: 0, y: -70, filter: "blur(10px)", duration: 0.3 }, i + 0.72);
        tl.to(q(`.ns-tick-${i}`), { opacity: 1, scale: 1.15, duration: 0.2 }, i === 0 ? 0 : i - 0.1);
        if (i < n - 1) tl.to(q(`.ns-tick-${i}`), { opacity: 0.3, scale: 1, duration: 0.2 }, i + 0.8);
      });
      // The first scene is already on screen when the pin starts.
      gsap.set(q(".ns-text-0"), { opacity: 1, y: 0, filter: "blur(0px)" });
    });
  }, [reduce]);

  if (reduce) return <Static />;

  return (
    <section ref={root} className="theme-dark relative h-svh overflow-hidden bg-ink" aria-label="A day at News Cafe, from breakfast to the last round">
      <div className="ns-parallax absolute -inset-y-[6%] inset-x-0">
        {scenes.map((s, i) => (
          <div key={s.time} className={cn("absolute inset-0", `ns-img-${i}`)} style={{ zIndex: i }}>
            <Image src={photo(s.image, 2000)} alt="" fill sizes="100vw" className="object-cover" />
          </div>
        ))}
      </div>
      {/* Colour grade changes with the hour */}
      {scenes.map((s, i) => (
        <div
          key={s.time}
          aria-hidden
          className={cn("absolute inset-0 mix-blend-color", `ns-tint-${i}`)}
          style={{ background: s.tint, zIndex: 10 + i }}
        />
      ))}
      <div className="absolute inset-0 z-20 bg-gradient-to-t from-ink via-ink/35 to-ink/60" />
      <div className="absolute inset-0 z-20 bg-gradient-to-r from-ink/80 via-ink/20 to-transparent" />

      <div className="container-x relative z-30 flex h-full flex-col justify-between py-24 md:py-28">
        <div className="flex items-start justify-between">
          <p className="eyebrow">A day at News Cafe</p>
          <p className="display ns-clock text-6xl tabular-nums text-gold-gradient md:text-9xl" aria-hidden>
            01 / 04
          </p>
        </div>

        <div className="relative min-h-[17rem] md:min-h-[20rem]">
          {scenes.map((s, i) => (
            <div key={s.time} className={cn("absolute inset-x-0 bottom-0 max-w-2xl", `ns-text-${i}`)} style={{ opacity: i === 0 ? 1 : 0 }}>
              <p className="eyebrow mb-4">{s.label}</p>
              <h2 className="display text-5xl md:text-8xl">{s.title}</h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-bone/75 md:text-lg">{s.text}</p>
            </div>
          ))}

          <svg
            viewBox="0 0 400 170"
            className="absolute bottom-0 right-0 hidden w-[26rem] overflow-visible md:block"
            fill="none"
            aria-hidden
          >
            <path d={ARC} stroke="rgba(243,237,226,0.15)" strokeWidth="1" strokeDasharray="3 6" />
            <path className="ns-arc" d={ARC} stroke="#c9a45c" strokeWidth="1.5" strokeLinecap="round" />
            <circle
              className="ns-dot"
              cx="10"
              cy="150"
              r="7"
              fill="#ecd39a"
              style={{ filter: "drop-shadow(0 0 10px rgba(236,211,154,0.9))" }}
            />
          </svg>
        </div>

        <ol className="mt-6 flex items-center gap-3 text-[0.62rem] uppercase tracking-[0.25em] text-bone md:gap-8">
          {scenes.map((s, i) => (
            <li key={s.time} className={cn("flex flex-1 flex-col gap-2 opacity-30", `ns-tick-${i}`)} style={{ opacity: i === 0 ? 1 : 0.3 }}>
              <span className="h-px w-full bg-gold" />
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
