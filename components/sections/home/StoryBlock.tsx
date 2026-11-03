"use client";

import { photo } from "@/lib/images";
import { ParallaxImage } from "@/components/ui/ParallaxImage";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Button } from "@/components/ui/Button";
import { Depth } from "@/components/ui/Depth";
import { DrawFrame, Swash } from "@/components/ui/Draw";

const menus = [
  { label: "Breakfast", note: "Start the day right" },
  { label: "Food", note: "New flavours" },
  { label: "Cocktails", note: "The full treatment" },
  { label: "Functions", note: "Year-end & more" },
];

/** Layered parallax: ghost type (far), photograph (mid), glass card + gold ring (near) all travel at different speeds. */
export function StoryBlock() {
  return (
    <section className="relative overflow-hidden bg-ink py-28 md:py-44">
      <Depth speed={-0.2} className="pointer-events-none absolute -left-[4vw] top-[8%] hidden md:block">
        <span aria-hidden className="display block text-[20vw] leading-none text-transparent [-webkit-text-stroke:1px_color-mix(in_srgb,var(--color-bone)_12%,transparent)]">GOOD</span>
      </Depth>
      <Depth speed={0.22} className="pointer-events-none absolute -right-[3vw] bottom-[6%] hidden md:block">
        <span aria-hidden className="display block text-[20vw] leading-none text-transparent [-webkit-text-stroke:1px_color-mix(in_srgb,var(--color-gold)_22%,transparent)]">VIBES</span>
      </Depth>

      <div className="container-x relative grid items-center gap-16 lg:grid-cols-12 lg:gap-12">
        <div className="relative lg:col-span-6">
          <div className="relative">
            <ParallaxImage
              src={photo("barDark", 1400)}
              alt="Backlit bar with warm lighting and leather seating"
              className="aspect-[4/5] w-full rounded-3xl"
              cursor="Our story"
            />
            <div className="pointer-events-none absolute -inset-4 hidden md:block">
              <DrawFrame radius={32} />
            </div>
          </div>
          <Depth speed={0.12} className="absolute -bottom-10 -right-2 hidden w-56 md:block lg:-right-12">
            <Reveal variant="scale" delay={0.3}>
              <div className="glass rounded-2xl p-6">
                <p className="display text-3xl leading-tight text-gold-gradient">It&apos;s about the vibe</p>
                <p className="mt-2 text-[0.62rem] uppercase tracking-[0.2em] text-mist">#ItsAboutTheVibe</p>
              </div>
            </Reveal>
          </Depth>
        </div>

        <div className="flex flex-col gap-10 lg:col-span-5 lg:col-start-8">
          <SectionHeading eyebrow="News Cafe" title="Good food. Great *cocktails.*" />
          <Reveal delay={0.1}>
            <p className="max-w-lg text-lg leading-relaxed text-bone/70">
              From breakfast to the last round, News Cafe is built around good food, great cocktails and an atmosphere
              you can&apos;t miss. Pull up for a slow morning, find us at Rush Hour, or make your next evening a News Cafe
              affair.
            </p>
          </Reveal>
          <Swash />
          <ul className="grid grid-cols-2 gap-x-6 gap-y-6 pt-2">
            {menus.map((m, i) => (
              <li key={m.label}>
                <Reveal delay={0.12 * i} y={30}>
                  <TransitionLink href="/menu" className="group block border-t border-line pt-4 transition-colors hover:border-gold">
                    <p className="display text-3xl text-bone transition-colors duration-500 group-hover:text-gold-light md:text-4xl">{m.label}</p>
                    <p className="mt-1 text-[0.68rem] uppercase tracking-[0.2em] text-mist">{m.note}</p>
                  </TransitionLink>
                </Reveal>
              </li>
            ))}
          </ul>
          <Reveal delay={0.2}>
            <Button href="/about" variant="ghost">
              Discover more
            </Button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
