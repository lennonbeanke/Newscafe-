"use client";

import Image from "next/image";
import { signatureCocktails } from "@/lib/menu-data";
import { menuPhotos } from "@/lib/menu-photos";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { MenuEntryRow } from "./MenuEntryRow";

/** The eight signature cocktails with their real prices; trade-up options are shown separately from the standard price. */
export function SignatureCocktails() {
  return (
    <section id="signature-cocktails" aria-labelledby="signature-title" className="relative overflow-hidden bg-ink py-24 md:py-36">
      <div aria-hidden className="pointer-events-none absolute -left-[12%] top-[6%] h-[60vmin] w-[60vmin] rounded-full bg-[radial-gradient(closest-side,rgba(124,179,66,0.22),transparent)]" />
      <div className="container-x relative grid gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-4">
          <div className="rounded-[2rem] bg-gradient-to-br from-[#7cb342] to-[#4d8a2a] p-3.5 shadow-[0_40px_90px_-35px_rgba(77,138,42,0.6)] lg:sticky lg:top-40">
            <Image
              src={menuPhotos.signature.src}
              alt={menuPhotos.signature.alt}
              width={menuPhotos.signature.width}
              height={menuPhotos.signature.height}
              sizes="(min-width: 1024px) 28vw, 100vw"
              className="aspect-[3/4] w-full rounded-[1.5rem] object-cover object-[30%_30%] lg:aspect-[2/3]"
            />
          </div>
        </Reveal>

        <div className="lg:col-span-8">
          <SectionHeading eyebrow="Cocktails" title="Signature *cocktails*" className="mb-4" />
          <span id="signature-title" className="sr-only">
            {signatureCocktails.title}
          </span>
          <span aria-hidden className="mb-8 block h-[3px] w-[72px] rounded-full bg-[#7cb342]" />
          <ul>
            {signatureCocktails.groups[0].entries.map((e) => (
              <MenuEntryRow key={e.name} entry={e} headingLevel="h3" />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
