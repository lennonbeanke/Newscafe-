"use client";

import { useRef } from "react";
import { milestones } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useGsap } from "@/hooks/useGsap";
import { SectionHeading } from "@/components/ui/SectionHeading";

/** Vertical timeline: the gold spine draws itself with scroll and each milestone lights up as it's reached. */
export function Timeline() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        ".tl-spine",
        { scaleY: 0 },
        { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".tl-list", start: "top 65%", end: "bottom 65%", scrub: true } },
      );
      gsap.utils.toArray<HTMLElement>(".tl-item").forEach((item) => {
        const dot = item.querySelector(".tl-dot");
        const body = item.querySelector(".tl-body");
        const tl = gsap.timeline({ scrollTrigger: { trigger: item, start: "top 72%", toggleActions: "play none none reverse" } });
        tl.fromTo(body, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, 0)
          .fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.6, ease: "back.out(2.5)" }, 0);
      });
    });
  }, []);

  return (
    <section ref={root} className="bg-coal py-28 md:py-44">
      <div className="container-x">
        <SectionHeading eyebrow="A day at News Cafe" title="Four menus, one *vibe*" className="mb-24" />
        <div className="tl-list relative mx-auto max-w-5xl">
          <span aria-hidden className="absolute left-4 top-0 h-full w-px bg-line md:left-1/2" />
          <span aria-hidden className="tl-spine absolute left-4 top-0 h-full w-px origin-top bg-gold md:left-1/2" />
          <ul className="flex flex-col gap-20 md:gap-32">
            {milestones.map((m, i) => (
              <li key={m.year} className="tl-item relative grid md:grid-cols-2">
                <span aria-hidden className="tl-dot absolute left-4 top-3 z-10 h-3 w-3 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_0_6px_rgba(201,164,92,0.15)] md:left-1/2" />
                <div className={cn("tl-body pl-12 md:pl-0", i % 2 === 0 ? "md:pr-20 md:text-right" : "md:col-start-2 md:pl-20")}>
                  <p className="display text-5xl text-gold-gradient sm:text-7xl md:text-6xl lg:text-8xl">{m.year}</p>
                  <h3 className="display mt-3 text-3xl md:text-4xl">{m.title}</h3>
                  <p className={cn("mt-4 text-bone/65 md:max-w-sm", i % 2 === 0 && "md:ml-auto")}>{m.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
