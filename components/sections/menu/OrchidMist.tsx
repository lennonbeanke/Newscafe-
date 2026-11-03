"use client";

import { orchidMist } from "@/lib/menu-data";
import { Reveal } from "@/components/ui/Reveal";

/** Potential promo, kept apart from the official cocktail menu until its ingredients and price are confirmed. */
export function OrchidMist() {
  return (
    <section id="orchid-mist" aria-labelledby="orchid-title" className="bg-coal py-20 md:py-28">
      <div className="container-x">
        <Reveal>
          <div className="mx-auto max-w-3xl rounded-3xl border border-dashed border-gold/50 p-8 md:p-12">
            <span className="inline-block rounded-full border border-gold/60 px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.22em] text-gold">Promo · not on the cocktail menu yet</span>
            <h2 id="orchid-title" className="display mt-5 text-5xl md:text-6xl">
              {orchidMist.name}
            </h2>
            <p className="mt-1 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-gold">The {orchidMist.partner} cocktail</p>
            <p className="mt-4 max-w-prose text-mist">{orchidMist.blurb}</p>
            <dl className="mt-6 grid gap-3 border-t border-line pt-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-mist">Ingredients</dt>
                <dd className="mt-1 text-bone/85">Awaiting confirmation</dd>
              </div>
              <div>
                <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-mist">Price</dt>
                <dd className="mt-1 text-bone/85">Awaiting confirmation</dd>
              </div>
            </dl>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
