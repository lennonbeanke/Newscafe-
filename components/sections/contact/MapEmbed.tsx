"use client";

import { useRef } from "react";
import { FiArrowUpRight } from "react-icons/fi";
import { fullAddress, site } from "@/lib/site";
import { useGsap } from "@/hooks/useGsap";

const query = encodeURIComponent(fullAddress);
const src = `https://www.google.com/maps?q=${query}&z=16&output=embed`;

/** Interactive Google map (looked up by address), recoloured to match the dark theme, unveiled with a scroll-driven clip + scale. */
export function MapEmbed() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, (gsap) => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(
        ".map-frame",
        { clipPath: "inset(18% 12% 18% 12% round 32px)", scale: 0.92 },
        { clipPath: "inset(0% 0% 0% 0% round 24px)", scale: 1, ease: "none", scrollTrigger: { trigger: root.current, start: "top 90%", end: "top 25%", scrub: true } },
      );
    });
  }, []);

  return (
    <section ref={root} className="px-[clamp(0.75rem,2vw,2rem)] pb-24 md:pb-36">
      <div className="map-frame relative mx-auto h-[70svh] max-w-[100rem] overflow-hidden rounded-3xl border border-line">
        <iframe
          title={`Map showing ${site.name} at ${fullAddress}`}
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0 h-full w-full border-0 [filter:invert(92%)_hue-rotate(180deg)_saturate(0.55)_contrast(0.92)_brightness(0.95)]"
        />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_color-mix(in_srgb,var(--color-ink)_90%,transparent)]" />
        <div className="glass absolute bottom-5 left-5 right-5 max-w-md rounded-2xl p-6 md:bottom-8 md:left-8">
          <p className="eyebrow mb-2 text-[0.62rem]">Head office</p>
          <p className="display text-3xl">{site.name}</p>
          <p className="mt-1 text-sm text-bone/70">{fullAddress}</p>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${query}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gold-light"
          >
            Get directions
            <FiArrowUpRight className="transition-transform duration-500 group-hover:-translate-y-1 group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </section>
  );
}
