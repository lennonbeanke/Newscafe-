"use client";

import { useRef } from "react";
import Image from "next/image";
import { FiArrowUpRight } from "react-icons/fi";
import { events } from "@/lib/data";
import { useGsap } from "@/hooks/useGsap";
import { useSheetRadius } from "@/hooks/useSheetRadius";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TransitionLink } from "@/components/ui/TransitionLink";

/** Pinned horizontal scroll: vertical scroll drives the card track sideways; images counter-drift for depth. */
export function EventsTrack() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useSheetRadius(root);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const el = track.current!;
      const distance = () => Math.max(0, el.scrollWidth - window.innerWidth);

      const move = gsap.to(el, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: () => `+=${distance()}`,
          pin: true,
          scrub: 0.8,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });

      gsap.utils.toArray<HTMLElement>(".ev-img").forEach((node) => {
        gsap.fromTo(
          node,
          { xPercent: 10 },
          {
            xPercent: -10,
            ease: "none",
            scrollTrigger: { trigger: node.parentElement, containerAnimation: move, start: "left right", end: "right left", scrub: true },
          },
        );
      });

      gsap.to(bar.current, {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: () => `+=${distance()}`, scrub: true, invalidateOnRefresh: true },
      });
    });
  }, []);

  return (
    <section ref={root} className="relative z-10 overflow-hidden bg-ink py-24 shadow-[0_-40px_80px_-20px_var(--sheet-shadow)] md:flex md:h-svh md:flex-col md:justify-center md:py-0">
      <div className="container-x mb-12 flex items-end justify-between gap-6 md:mb-14">
        <SectionHeading eyebrow="Promos" title="What's *on* at News Cafe" />
        <TransitionLink
          href="/events"
          className="group hidden items-center gap-2 pb-3 text-xs font-semibold uppercase tracking-[0.25em] text-gold-light md:flex"
        >
          All promos
          <FiArrowUpRight className="transition-transform duration-500 group-hover:-translate-y-1 group-hover:translate-x-1" />
        </TransitionLink>
      </div>

      <div className="no-scrollbar snap-x snap-mandatory overflow-x-auto md:snap-none md:overflow-visible">
        <div ref={track} className="flex w-max gap-5 px-[clamp(1.25rem,4vw,4rem)] md:gap-8">
          {events.map((e) => (
            <article
              key={e.id}
              className="theme-dark group relative h-[58svh] min-h-[420px] w-[80vw] shrink-0 snap-center overflow-hidden rounded-3xl md:h-[54svh] md:w-[min(34vw,520px)]"
            >
              <div className="absolute inset-y-0 -inset-x-[12%]">
                <div className="ev-img relative h-full w-full">
                  <Image src={e.image} alt={e.title} fill sizes="40vw" className="object-cover transition-transform duration-[1400ms] ease-lux group-hover:scale-105" />
                </div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10" />
              <TransitionLink href="/events" className="absolute inset-0 z-10" aria-label={`${e.title} — see events`} data-cursor="View" />

              <div className="absolute inset-x-0 top-0 flex items-start justify-between p-6">
                <div className="glass rounded-2xl px-5 py-3 text-center">
                  <p className="display text-4xl leading-none text-gold-light">{e.day}</p>
                  <p className="mt-1 text-[0.6rem] uppercase tracking-[0.25em] text-bone/70">{e.month}</p>
                </div>
                <span className="glass rounded-full px-4 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em]">{e.kind}</span>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
                <h3 className="display text-4xl md:text-5xl">{e.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-bone/70 opacity-100 transition-all duration-700 md:translate-y-3 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100">
                  {e.blurb}
                </p>
              </div>
            </article>
          ))}

          <TransitionLink
            href="/events"
            data-cursor="Go"
            className="group flex h-[58svh] min-h-[420px] w-[70vw] shrink-0 snap-center flex-col items-center justify-center gap-6 rounded-3xl border border-line transition-colors duration-700 hover:border-gold md:h-[54svh] md:w-[28vw]"
          >
            <span className="flex h-24 w-24 items-center justify-center rounded-full border border-gold text-gold transition-all duration-700 group-hover:scale-110 group-hover:bg-gold group-hover:text-ink">
              <FiArrowUpRight size={34} />
            </span>
            <span className="display text-4xl">All promos</span>
          </TransitionLink>
        </div>
      </div>

      <div className="container-x mt-10 hidden md:block">
        <div className="h-px w-full bg-line">
          <span ref={bar} className="block h-px origin-left scale-x-0 bg-gold" />
        </div>
      </div>
    </section>
  );
}
