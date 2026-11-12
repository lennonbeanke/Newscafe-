import Image from "next/image";
import { cn } from "@/lib/utils";
import { sectionPhotos } from "@/lib/menu-photos";
import type { MenuSection } from "@/types";
import { MenuEntryRow } from "./MenuEntryRow";

function PriceHeader({ labels }: { labels: [string, string] }) {
  return (
    <div aria-hidden className="mb-1 flex justify-end gap-3 border-b border-line pb-2 text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-mist">
      {labels.map((l) => (
        <span key={l} className="min-w-[3.25rem] text-right sm:min-w-[4rem]">
          {l}
        </span>
      ))}
    </div>
  );
}

/** A menu section: heading, optional note, optional photograph, then its groups and entries. */
export function MenuSectionView({ section }: { section: MenuSection }) {
  const photo = sectionPhotos[section.id];
  const side = photo && photo.layout !== "wide";
  const twoCol = !side && !section.priceLabels;

  const list = (
    <div>
      <header className="mb-6">
        <h3 id={`${section.id}-title`} className="display text-4xl md:text-6xl">{section.title}</h3>
        {section.subtitle && <p className="mt-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-gold">{section.subtitle}</p>}
        {section.note && <p className="mt-3 max-w-prose text-sm leading-relaxed text-mist">{section.note}</p>}
      </header>

      {photo?.layout === "wide" && (
        <div className="relative mb-8 overflow-hidden rounded-3xl">
          <Image src={photo.photo.src} alt={photo.photo.alt} width={photo.photo.width} height={photo.photo.height} sizes="(min-width: 1280px) 1100px, 100vw" className="max-h-[420px] w-full object-cover" />
        </div>
      )}

      {section.priceLabels && <PriceHeader labels={section.priceLabels} />}

      {section.groups.map((g, i) => (
        <div key={g.title ?? i} className={cn(i > 0 && "mt-10")}>
          {g.title && (
            <div className="mb-1 mt-2">
              <h4 className="eyebrow">{g.title}</h4>
              {g.note && <p className="mt-2 text-sm text-mist">{g.note}</p>}
            </div>
          )}
          {!g.title && g.note && <p className="mb-2 text-sm text-mist">{g.note}</p>}
          <ul className={cn(twoCol && "lg:columns-2 lg:gap-x-14")}>
            {g.entries.map((e, idx) => (
              <MenuEntryRow key={`${e.name}-${idx}`} entry={e} columns={section.priceLabels} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <section id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-44 border-t border-line py-12 first:border-t-0 md:py-16">
      {side ? (
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
          <div className={cn("lg:col-span-4", photo.layout === "side-right" && "lg:order-2")}>
            <div className="overflow-hidden rounded-3xl shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] lg:sticky lg:top-48">
              <Image src={photo.photo.src} alt={photo.photo.alt} width={photo.photo.width} height={photo.photo.height} sizes="(min-width: 1024px) 28vw, 100vw" className="max-h-[420px] w-full object-cover lg:max-h-[78svh]" />
            </div>
          </div>
          <div className="lg:col-span-8">{list}</div>
        </div>
      ) : (
        list
      )}
    </section>
  );
}
