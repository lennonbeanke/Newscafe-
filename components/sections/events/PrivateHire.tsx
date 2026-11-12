"use client";

import { photo } from "@/lib/images";
import { ParallaxImage } from "@/components/ui/ParallaxImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";

const perks = ["A set menu for your group", "Good food and great cocktails", "Unmistakable atmosphere", "Book by email: info@newscafe.co.za"];

export function PrivateHire() {
  return (
    <section className="py-28 md:py-44">
      <div className="container-x grid items-center gap-16 lg:grid-cols-12">
        <div className="flex flex-col gap-8 lg:col-span-5">
          <SectionHeading eyebrow="Functions" title="Make your year-end a *News Cafe* experience" />
          <Reveal delay={0.1}>
            <p className="text-lg leading-relaxed text-bone/70">
              Bring the team together for a celebration like no other. Good food, great cocktails and an atmosphere that
              does the talking. Email us to make a booking.
            </p>
          </Reveal>
          <ul className="flex flex-col gap-4">
            {perks.map((p, i) => (
              <li key={p}>
                <Reveal delay={0.08 * i} variant="left" y={0}>
                  <div className="flex items-center gap-4 border-b border-line pb-4 text-bone/80">
                    <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
                    {p}
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
          <Reveal delay={0.2}>
            <Button href="/contact#enquire">Enquire about functions</Button>
          </Reveal>
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <ParallaxImage src={photo("toast", 1600)} alt="Guests raising a toast at a function" className="aspect-[4/5] rounded-3xl" cursor="Private" />
        </div>
      </div>
    </section>
  );
}
