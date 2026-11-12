import type { Metadata } from "next";
import { PageHero } from "@/components/layout/PageHero";
import { RushHour } from "@/components/sections/menu/RushHour";
import { SignatureCocktails } from "@/components/sections/menu/SignatureCocktails";
import { MenuBooks } from "@/components/sections/menu/MenuBooks";
import { OrchidMist } from "@/components/sections/menu/OrchidMist";
import { ReserveCta } from "@/components/sections/home/ReserveCta";
import { JsonLd } from "@/components/ui/JsonLd";
import { menuBooks, setMenus, signatureCocktails } from "@/lib/menu-data";
import { menuPhotos } from "@/lib/menu-photos";
import { site } from "@/lib/site";
import type { MenuEntry } from "@/types";

export const metadata: Metadata = {
  title: "Menus — Breakfast, Food, Cocktails & Functions",
  description:
    "The full News Cafe menus: breakfast, food, cocktails, wine and spirits, and functions set menus, plus Rush Hour cocktails daily from 2pm to 6pm.",
  alternates: { canonical: "/menu" },
  openGraph: { url: "/menu", title: `Menus — ${site.name}` },
};

const offers = (e: MenuEntry) =>
  [
    ...(e.price !== undefined ? [{ "@type": "Offer", price: e.price, priceCurrency: "ZAR" }] : []),
    ...(e.prices ?? []).map((p) => ({ "@type": "Offer", name: p.label, price: p.amount, priceCurrency: "ZAR" })),
  ];

const entries = (list: MenuEntry[]) => list.map((e) => ({ "@type": "MenuItem", name: e.name, ...(offers(e).length ? { offers: offers(e) } : {}) }));

const menuSchema = {
  "@context": "https://schema.org",
  "@type": "Menu",
  name: `${site.name} Menus`,
  inLanguage: "en",
  hasMenuSection: [
    ...menuBooks.map((b) => ({
      "@type": "MenuSection",
      name: b.label,
      description: b.tagline,
      hasMenuSection: b.sections.map((s) => ({ "@type": "MenuSection", name: s.title, hasMenuItem: entries(s.groups.flatMap((g) => g.entries)) })),
    })),
    { "@type": "MenuSection", name: signatureCocktails.title, hasMenuItem: entries(signatureCocktails.groups.flatMap((g) => g.entries)) },
    {
      "@type": "MenuSection",
      name: "Set menus",
      hasMenuItem: setMenus.map((m) => ({ "@type": "MenuItem", name: m.title, description: m.includes, offers: { "@type": "Offer", price: m.price, priceCurrency: "ZAR" } })),
    },
  ],
};

export default function MenuPage() {
  return (
    <>
      <JsonLd data={menuSchema} />
      <PageHero
        eyebrow="The Menus"
        title="Good food. Great *cocktails.*"
        subtitle="Breakfast, food, cocktails and functions, all with News Cafe's unmistakable atmosphere."
        image={menuPhotos.hero.src}
        alt={menuPhotos.hero.alt}
      />
      <RushHour />
      <SignatureCocktails />
      <MenuBooks />
      <OrchidMist />
      <ReserveCta />
    </>
  );
}
