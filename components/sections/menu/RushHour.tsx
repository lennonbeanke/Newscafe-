"use client";

import Image from "next/image";
import { rushHour } from "@/lib/menu-data";
import { menuPhotos } from "@/lib/menu-photos";
import { Reveal } from "@/components/ui/Reveal";
import { Marquee } from "@/components/ui/Marquee";

/** Rush Hour: the single bold, saturated moment on the Menu page. Colours are fixed (not theme-driven) in light and dark. */
export function RushHour() {
  return (
    <section id="rush-hour" aria-labelledby="rush-hour-title" className="relative overflow-hidden bg-coal py-24 md:py-36">
      <div aria-hidden className="pointer-events-none absolute -right-[12%] -top-[22%] h-[70vmin] w-[70vmin] rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.28),rgba(246,201,14,0.1)_60%,transparent)]" />
      <div className="container-x relative grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-7">
          <div className="theme-dark relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-[#9d0f2c] via-[#e11d48] to-[#f08a1d] p-8 text-white shadow-[0_40px_90px_-35px_rgba(225,29,72,0.7)] md:p-14">
            <p className="eyebrow !text-white/90">{rushHour.title}</p>
            <h2 id="rush-hour-title" className="display mt-4 text-5xl md:text-7xl">
              {rushHour.label.split(" ")[0]} <em>{rushHour.label.split(" ")[1]}</em>
            </h2>

            <dl className="mt-8 flex flex-wrap items-end gap-x-12 gap-y-6">
              <div>
                <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-white/80">{rushHour.days} from</dt>
                <dd className="display text-4xl md:text-5xl">{rushHour.hours}</dd>
              </div>
              <div>
                <dt className="text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-white/80">Per cocktail</dt>
                <dd className="display text-5xl text-[#ffe27a] md:text-6xl">
                  <span className="mr-1 align-top text-[0.5em]">R</span>
                  {rushHour.price}
                </dd>
              </div>
            </dl>

            <ul className="mt-8 flex flex-wrap gap-2" aria-label="Rush Hour cocktails">
              {rushHour.cocktails.map((c) => (
                <li key={c} className="rounded-full border border-white/40 bg-white/15 px-4 py-2 text-sm font-medium">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal variant="scale" delay={0.15} className="lg:col-span-5">
          <div className="overflow-hidden rounded-3xl shadow-[0_40px_90px_-30px_rgba(225,29,72,0.45)]">
            <Image
              src={menuPhotos.rush.src}
              alt={menuPhotos.rush.alt}
              width={menuPhotos.rush.width}
              height={menuPhotos.rush.height}
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="aspect-[4/5] w-full object-cover object-top"
            />
          </div>
        </Reveal>
      </div>
      <Marquee items={[...rushHour.cocktails]} reverse decorative className="display mt-20 text-5xl text-bone/10 md:text-8xl" />
    </section>
  );
}
