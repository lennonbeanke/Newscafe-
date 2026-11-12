"use client";

import { photo } from "@/lib/images";
import { site } from "@/lib/site";
import { ParallaxImage } from "@/components/ui/ParallaxImage";
import { SplitReveal } from "@/components/ui/SplitReveal";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";
import { Depth } from "@/components/ui/Depth";
import { Ornament } from "@/components/ui/Draw";

export function ReserveCta() {
  return (
    <section className="theme-dark relative isolate flex min-h-[90svh] items-center justify-center overflow-hidden bg-ink">
      <div className="absolute inset-0 -z-10">
        <ParallaxImage src={photo("redNight", 2000)} alt="" reveal={false} speed={18} sizes="100vw" className="h-full w-full" />
      </div>
      <div className="absolute inset-0 -z-10 bg-ink/70" />
      <Depth speed={0.25} className="pointer-events-none absolute -left-[10%] top-[10%] -z-10 h-[60vmin] w-[60vmin] rounded-full bg-[radial-gradient(closest-side,rgba(201,164,92,0.28),transparent)]"><span /></Depth>
      <Depth speed={-0.18} className="pointer-events-none absolute -right-[8%] bottom-[0%] -z-10 h-[70vmin] w-[70vmin] rounded-full bg-[radial-gradient(closest-side,rgba(176,64,84,0.3),transparent)]"><span /></Depth>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-coal via-transparent to-ink" />

      <div className="container-x flex flex-col items-center gap-8 py-28 text-center">
        <Reveal>
          <p className="eyebrow">Functions & bookings</p>
        </Reveal>
        <Ornament />
        <SplitReveal as="h2" text="Make your next evening a *News Cafe* affair" className="text-[clamp(3rem,7.6vw,8rem)]" />
        <Reveal delay={0.2}>
          <p className="max-w-lg text-lg text-bone/75">
            Bring the team together for a celebration like no other. Email us to make a booking.
          </p>
        </Reveal>
        <Reveal delay={0.3} className="flex flex-col items-center gap-4 sm:flex-row">
          <Button href="/contact#enquire">Enquire now</Button>
          <Button href={`mailto:${site.email}`} variant="glass">
            {site.email}
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
