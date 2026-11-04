import type { Metadata } from "next";
import { PageHero } from "@/components/layout/PageHero";
import { EventsList } from "@/components/sections/events/EventsList";
import { PrivateHire } from "@/components/sections/events/PrivateHire";
import { ReserveCta } from "@/components/sections/home/ReserveCta";
import { photo } from "@/lib/images";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Promos — Rush Hour, New Menus & Year-End Functions",
  description:
    "Rush Hour, the new summer food menu, Glenfiddich Orchid Mist and year-end functions. See what's on at News Cafe.",
  alternates: { canonical: "/events" },
  openGraph: { url: "/events", title: `Promos — ${site.name}` },
};

export default function EventsPage() {
  return (
    <>
      <PageHero
        eyebrow="Promos"
        title="What's *on*"
        subtitle="Rush Hour, new menus, Glenfiddich and year-end functions. Find your next reason to come in."
        image={photo("terrace", 2400)}
        alt="Terrace tables at golden hour"
      />
      <EventsList />
      <PrivateHire />
      <ReserveCta />
    </>
  );
}
