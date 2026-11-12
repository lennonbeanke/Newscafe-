"use client";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Depth } from "@/components/ui/Depth";
import { GalleryReel } from "@/components/sections/gallery/GalleryReel";

/** Two opposing infinite rows. Drag them, flick them, or just scroll — the page velocity pushes them along. */
export function GalleryTeaser() {
  return (
    <section className="relative overflow-hidden bg-coal py-28 md:py-44">
      <Depth speed={-0.14} className="pointer-events-none absolute inset-x-0 top-[6%] hidden md:block">
        <span aria-hidden className="display block whitespace-nowrap text-center text-[22vw] leading-none text-transparent [-webkit-text-stroke:1px_color-mix(in_srgb,var(--color-bone)_10%,transparent)]">GALLERY</span>
      </Depth>
      <div className="container-x relative mb-20 flex flex-col items-center gap-10 text-center">
        <SectionHeading eyebrow="Gallery" title="Catch our *vibe*" align="center" />
        <Reveal>
          <Button href="/gallery" variant="ghost">
            Enter the gallery
          </Button>
        </Reveal>
      </div>
      <GalleryReel rows={2} className="relative" />
    </section>
  );
}
