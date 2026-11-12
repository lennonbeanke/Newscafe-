"use client";

import { useRef } from "react";
import Image from "next/image";
import { photo } from "@/lib/images";
import { parseAccent } from "@/lib/text";
import { cn } from "@/lib/utils";
import { useGsap } from "@/hooks/useGsap";
import { Ornament } from "@/components/ui/Draw";

const statement =
  "News Cafe is *good food, great cocktails* and an atmosphere you can't miss. From breakfast to the last round, it's all about the vibe.";

/** Pinned, scroll-scrubbed manifesto: words light up one by one while three photographs drift at different depths. */
export function Statement() {
  const root = useRef<HTMLElement>(null);
  const words = parseAccent(statement);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: root.current, start: "top top", end: `+=${window.innerWidth < 768 ? 220 : 280}%`, scrub: 0.6, pin: true },
      });
      tl.to(".st-word", { opacity: 1, stagger: 0.12, ease: "none" }, 0)
        // Three depth planes: far (slow, small, dim), mid, near (fast, large, bright)
        .fromTo(".st-img-a", { yPercent: 50, rotate: -5 }, { yPercent: -60, rotate: 4, ease: "none" }, 0)
        .fromTo(".st-img-b", { yPercent: 110, rotate: 6 }, { yPercent: -95, rotate: -3, ease: "none" }, 0)
        .fromTo(".st-img-c", { yPercent: 20, rotate: 2 }, { yPercent: -35, rotate: -2, ease: "none" }, 0)
        .fromTo(".st-ghost", { xPercent: 6 }, { xPercent: -14, ease: "none" }, 0);
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(".st-word", { opacity: 1 });
    });
  }, []);

  return (
    <section ref={root} className="relative flex h-svh items-center overflow-hidden bg-ink">
      <div aria-hidden className="st-ghost pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 whitespace-nowrap">
        <span className="display block text-[28vw] leading-none text-transparent [-webkit-text-stroke:1px_color-mix(in_srgb,var(--color-gold)_22%,transparent)]">THE VIBE</span>
      </div>

      <div className="st-img-c absolute left-[8%] top-[64%] hidden h-[26vh] w-[11vw] min-w-32 overflow-hidden rounded-xl opacity-30 md:block">
        <Image src={photo("martini", 600)} alt="" fill sizes="15vw" className="object-cover" />
      </div>
      <div className="st-img-a absolute -left-6 top-[22%] hidden h-[38vh] w-[16vw] min-w-40 overflow-hidden rounded-2xl opacity-75 md:block lg:left-[4vw]">
        <Image src={photo("whiskey", 800)} alt="Bourbon over a hand-cut ice sphere" fill sizes="20vw" className="object-cover" />
      </div>
      <div className="st-img-b absolute -right-6 top-[30%] hidden h-[46vh] w-[18vw] min-w-44 overflow-hidden rounded-2xl opacity-80 md:block lg:right-[4vw]">
        <Image src={photo("steak", 800)} alt="Dry-aged steak and fries" fill sizes="20vw" className="object-cover" />
      </div>

      <div className="container-x relative z-10">
        <div className="mb-8 flex flex-col items-center gap-5">
          <p className="eyebrow">It&apos;s about the vibe</p>
          <Ornament />
        </div>
        <p className="display mx-auto max-w-5xl text-center text-[clamp(2rem,5.2vw,5rem)] leading-[1.08]">
          {words.map(({ w, accent }, i) => (
            <span key={i} className={cn("st-word inline-block opacity-40", accent && "italic text-gold-gradient")}>
              {w}&nbsp;
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
