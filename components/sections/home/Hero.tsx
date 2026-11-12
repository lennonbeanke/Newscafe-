"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { m as motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { site } from "@/lib/site";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useGsap } from "@/hooks/useGsap";
import { SplitReveal } from "@/components/ui/SplitReveal";
import { Button } from "@/components/ui/Button";

// Bokeh orbs: radial gradients (no blur filter) animated with CSS transforms so they stay on the compositor.
const orbs = [
  { l: "8%", t: "62%", s: 150, d: 9 },
  { l: "30%", t: "26%", s: 90, d: 12 },
  { l: "46%", t: "74%", s: 210, d: 14 },
  { l: "66%", t: "20%", s: 120, d: 10 },
  { l: "74%", t: "58%", s: 260, d: 16 },
  { l: "90%", t: "36%", s: 100, d: 11 },
];

export function Hero() {
  const reduce = useReducedMotion();
  const fine = useMediaQuery("(pointer: fine)");
  const root = useRef<HTMLElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // Pointer position, normalised to -1…1 (parallax) and in px (spotlight).
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 60, damping: 18, mass: 0.8 });
  const smy = useSpring(my, { stiffness: 60, damping: 18, mass: 0.8 });
  const sX = useSpring(spotX, { stiffness: 90, damping: 22, mass: 0.6 });
  const sY = useSpring(spotY, { stiffness: 90, damping: 22, mass: 0.6 });

  // Depth layers move by different amounts: far (video) < mid (orbs) < near (copy).
  const mediaX = useTransform(smx, (v) => v * -16);
  const mediaY = useTransform(smy, (v) => v * -10);
  const orbX = useTransform(smx, (v) => v * 42);
  const orbY = useTransform(smy, (v) => v * 28);
  const beamX = useTransform(smx, (v) => v * 22);
  const copyX = useTransform(smx, (v) => v * 8);
  const copyY = useTransform(smy, (v) => v * 6);
  const rotY = useTransform(smx, (v) => v * 1.6);
  const rotX = useTransform(smy, (v) => v * -1.2);
  const spotTx = useTransform(sX, (v) => v - 450);
  const spotTy = useTransform(sY, (v) => v - 450);

  // Rich lighting (beams, spotlight, light leak, bokeh) only for pointer devices: phones keep the footage,
  // grade, grain and copy, which keeps the hero smooth on mid-range hardware.
  const interactive = fine && !reduce;
  const fx = interactive;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    spotX.set(width * 0.64);
    spotY.set(height * 0.4);

    if (interactive) {
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
        my.set(((e.clientY - r.top) / r.height) * 2 - 1);
        spotX.set(e.clientX - r.left);
        spotY.set(e.clientY - r.top);
      };
      el.addEventListener("pointermove", onMove, { passive: true });
      return () => el.removeEventListener("pointermove", onMove);
    }
  }, [interactive, mx, my, spotX, spotY]);

  // Start the video only after the page has loaded and gone idle, so the poster owns LCP.
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (reduce || conn?.saveData || !site.heroVideo) return;
    const start = () => setVideoSrc(window.innerWidth < 768 ? site.heroVideoMobile : site.heroVideo);
    const kick = () =>
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(start, { timeout: 2500 })
        : window.setTimeout(start, 600);
    if (document.readyState === "complete") kick();
    else window.addEventListener("load", kick, { once: true });
    return () => window.removeEventListener("load", kick);
  }, [reduce]);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const st = { trigger: root.current, start: "top top", end: "bottom top", scrub: true };
      // The next section slides over the hero like a curtain while the hero recedes.
      gsap.timeline({ scrollTrigger: { ...st, pin: true, pinSpacing: false } });
      gsap.to(media.current, { scale: 1.25, yPercent: 8, ease: "none", scrollTrigger: st });
      gsap.to(content.current, { yPercent: -22, opacity: 0, ease: "none", scrollTrigger: { ...st, end: "60% top" } });
      gsap.to(shade.current, { opacity: 0.85, ease: "none", scrollTrigger: st });
    });
  }, []);

  return (
    <section ref={root} className="theme-dark relative flex h-svh min-h-[660px] items-end overflow-hidden bg-ink">
      {/* Layer 0 — footage: poster for instant paint, video fades in over it */}
      <div ref={media} className="absolute inset-0 will-change-transform">
        <motion.div className="absolute -inset-[6%]" style={interactive ? { x: mediaX, y: mediaY } : undefined}>
          <div className="absolute inset-0 animate-[kenburns_3.4s_cubic-bezier(0.16,1,0.3,1)_both]">
            <Image
              src={site.heroPoster}
              alt=""
              fill
              priority
              fetchPriority="high"
              quality={70}
              sizes="100vw"
              className="object-cover object-[60%_50%]"
            />
            {videoSrc && (
              <video
                className={`absolute inset-0 h-full w-full object-cover object-[60%_50%] transition-opacity duration-[1800ms] ${playing ? "opacity-100" : "opacity-0"}`}
                src={videoSrc}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-hidden
                onPlaying={() => setPlaying(true)}
              />
            )}
          </div>
        </motion.div>
      </div>

      {/* Layer 1 — grade, vignette, grain */}
      <div className="absolute inset-0 bg-ink/35" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/25 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_45%,transparent_30%,rgba(6,6,6,0.75)_100%)]" />

      {/* Layer 2 — light: sweeping beams, cursor spotlight, drifting light leak (pointer devices only) */}
      {fx && (
        <>
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ x: beamX }}>
            <div className="beam left-[2%] opacity-[0.16] [animation:beam-a_14s_ease-in-out_infinite]" />
            <div className="beam right-[0%] opacity-[0.12] [animation:beam-b_17s_ease-in-out_infinite]" />
          </motion.div>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-[900px] w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(255,226,160,0.24),rgba(255,200,120,0.07)_55%,transparent)] mix-blend-screen will-change-transform"
            style={{ x: spotTx, y: spotTy }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-y-20 left-0 w-[35%] -skew-x-[20deg] bg-gradient-to-r from-transparent via-[rgba(255,214,150,0.10)] to-transparent mix-blend-screen"
            animate={{ x: ["-60%", "330%"] }}
            transition={{ duration: 15, repeat: Infinity, repeatDelay: 5, ease: "linear" }}
          />
        </>
      )}
      <div className="grain absolute inset-0 overflow-hidden" />

      {/* Layer 3 — bokeh, nearer than the footage */}
      {fx && (
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ x: orbX, y: orbY }}>
          {orbs.map((o, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-[radial-gradient(closest-side,rgba(201,164,92,0.5),transparent)]"
              style={{ left: o.l, top: o.t, width: o.s, height: o.s, animation: `orb ${o.d}s ease-in-out ${i * -1.7}s infinite` }}
            />
          ))}
        </motion.div>
      )}

      {/* Layer 4 — copy, nearest to the viewer. Entrance is CSS-driven so it paints before hydration. */}
      <div ref={content} className="container-x relative z-10 pb-[15vh] pt-40 [perspective:1200px]">
        <motion.div style={interactive ? { x: copyX, y: copyY, rotateX: rotX, rotateY: rotY } : undefined} className="max-w-5xl">
          <p className="eyebrow intro-fade mb-8 flex items-center gap-4 [--d:0.1s]">
            <span className="intro-grow block h-px w-14 bg-gold [--d:0.2s]" />
            {site.tagline}
          </p>

          <SplitReveal
            as="h1"
            by="char"
            trigger="intro"
            delay={0.15}
            text="It's about the *vibe*"
            className="text-[clamp(3.6rem,9.6vw,9.6rem)]"
          />

          <p className="mt-8 max-w-md text-base leading-relaxed text-bone/75 md:text-xl">
            Breakfast, food and cocktails, all with an atmosphere you can&apos;t miss.
          </p>

          <div className="intro-fade mt-10 flex flex-col items-start gap-4 [--d:0.65s] sm:flex-row sm:items-center">
            <div className="animate-float">
              <Button href="/menu">Explore the menu</Button>
            </div>
            <div className="animate-float [animation-delay:-3s]">
              <Button href="/contact#enquire" variant="glass">
                Book a function
              </Button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom rail */}
      <div className="intro-fade container-x absolute inset-x-0 bottom-8 z-10 flex items-end justify-between text-[0.68rem] uppercase tracking-[0.28em] text-mist [--d:0.9s]">
        <span className="hidden md:block">{site.address.suburb}, {site.address.city}</span>
        <span className="flex flex-col items-center gap-3 max-md:mx-auto">
          Scroll
          <span className="relative block h-14 w-px overflow-hidden bg-line">
            <span className="absolute inset-x-0 top-0 h-1/2 animate-[scroll-cue_2s_ease-in-out_infinite] bg-gold" />
          </span>
        </span>
        <span className="hidden md:block">#ItsAboutTheVibe</span>
      </div>

      <div ref={shade} className="pointer-events-none absolute inset-0 bg-ink opacity-0" />
    </section>
  );
}
