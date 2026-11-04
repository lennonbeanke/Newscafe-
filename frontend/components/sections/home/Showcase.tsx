"use client";

import Image from "next/image";
import { m as motion, type Variants } from "framer-motion";
import { photo, type PhotoKey } from "@/lib/images";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { TiltCard } from "@/components/ui/TiltCard";
import { Distort } from "@/components/ui/Distort";

interface Feature {
  tag: string;
  name: string;
  blurb: string;
  price: string;
  image: PhotoKey;
  span: string;
}

const features: Feature[] = [
  { tag: "Cocktails", name: "Cocktail Menu", blurb: "Great cocktails for the night that deserves the full treatment.", price: "", image: "bartender", span: "md:col-span-7 md:row-span-2 min-h-[480px]" },
  { tag: "Food", name: "Food Menu", blurb: "New flavours. New favourites. The new summer menu is live.", price: "", image: "steak", span: "md:col-span-5 min-h-[320px]" },
  { tag: "Breakfast", name: "Breakfast Menu", blurb: "Start the day the News Cafe way.", price: "", image: "shared", span: "md:col-span-5 min-h-[320px]" },
  { tag: "At the bar", name: "Glenfiddich Orchid Mist", blurb: "A classic double, or the Orchid Mist cocktail. Experience Glenfiddich at News Cafe.", price: "", image: "whiskey", span: "md:col-span-6 min-h-[360px]" },
  { tag: "Functions", name: "Set Menu", blurb: "Bring the team together for a celebration like no other.", price: "", image: "toast", span: "md:col-span-6 min-h-[360px]" },
];

const grid: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.14 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 90, scale: 0.92, filter: "blur(14px)" },
  show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 1.3, ease: [0.16, 1, 0.3, 1] } },
};

export function Showcase() {
  return (
    <section className="relative bg-coal py-28 md:py-44">
      <div className="container-x">
        <div className="mb-16 flex flex-col justify-between gap-10 md:mb-24 md:flex-row md:items-end">
          <SectionHeading eyebrow="Our Menus" title="Taste the *vibe*" />
          <Reveal className="max-w-sm" delay={0.2}>
            <p className="text-bone/65">
              Breakfast, food, cocktails and functions: pick your menu and come find your new favourites.
            </p>
          </Reveal>
        </div>

        <motion.div
          variants={grid}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          className="grid grid-cols-1 gap-5 [perspective:1600px] md:grid-cols-12 md:auto-rows-[minmax(320px,auto)]"
        >
          {features.map((f) => (
            <motion.div key={f.name} variants={card} className={cn("relative", f.span)}>
              <TiltCard className="h-full" max={7}>
                <article className="theme-dark group relative h-full min-h-[inherit] overflow-hidden rounded-3xl">
                  <TransitionLink href="/menu" className="absolute inset-0 z-10" aria-label={`${f.name} — view menu`} data-cursor="Menu" />
                  <Distort className="absolute inset-0">
                    {/* Counter-shift against the tilt: the photograph sits "behind" the card plane */}
                    <div className="absolute inset-0 scale-[1.12] [transform:translate(calc(var(--px,0)*-16px),calc(var(--py,0)*-16px))_scale(1.12)]">
                      <Image
                        src={photo(f.image, 1400)}
                        alt={f.name}
                        fill
                        sizes="(min-width: 768px) 50vw, 100vw"
                        className="object-cover transition-transform duration-[1400ms] ease-lux group-hover:scale-110"
                      />
                    </div>
                  </Distort>
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/10 to-transparent transition-opacity duration-700 group-hover:from-ink/95" />
                  <div className="absolute inset-x-4 bottom-4 z-0 translate-y-3 transition-transform duration-700 ease-lux group-hover:translate-y-0 md:inset-x-6 md:bottom-6">
                    <div className="glass rounded-2xl p-5 md:p-6">
                      <p className="eyebrow mb-2 text-[0.62rem]">{f.tag}</p>
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="display text-3xl md:text-4xl">{f.name}</h3>
                        <span aria-hidden className="display text-2xl text-gold-light">→</span>
                      </div>
                      <p className="grid grid-rows-[0fr] text-sm leading-relaxed text-bone/75 transition-all duration-700 ease-lux group-hover:mt-3 group-hover:grid-rows-[1fr] max-md:mt-3 max-md:grid-rows-[1fr]">
                        <span className="overflow-hidden">{f.blurb}</span>
                      </p>
                    </div>
                  </div>
                </article>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>

        <Reveal className="mt-16 flex justify-center">
          <Button href="/menu">Explore the menus</Button>
        </Reveal>
      </div>
    </section>
  );
}
