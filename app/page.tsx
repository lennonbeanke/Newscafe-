import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Hero } from "@/components/sections/home/Hero";
import { PressStrip } from "@/components/sections/home/PressStrip";
import { Statement } from "@/components/sections/home/Statement";
import { Cover } from "@/components/ui/Cover";
import { LazyHydrate } from "@/components/ui/LazyHydrate";
import { site } from "@/lib/site";

// Everything below the fold is code-split so the hero (and LCP) ships with minimal JavaScript.
const StoryBlock = dynamic(() => import("@/components/sections/home/StoryBlock").then((m) => m.StoryBlock));
const SpaceReveal = dynamic(() => import("@/components/sections/home/SpaceReveal").then((m) => m.SpaceReveal));
const NightStory = dynamic(() => import("@/components/sections/home/NightStory").then((m) => m.NightStory));
const Showcase = dynamic(() => import("@/components/sections/home/Showcase").then((m) => m.Showcase));
const EventsTrack = dynamic(() => import("@/components/sections/home/EventsTrack").then((m) => m.EventsTrack));
const GalleryTeaser = dynamic(() => import("@/components/sections/home/GalleryTeaser").then((m) => m.GalleryTeaser));
const ReserveCta = dynamic(() => import("@/components/sections/home/ReserveCta").then((m) => m.ReserveCta));

export const metadata: Metadata = {
  title: { absolute: `${site.name} — Good Food. Great Cocktails. Unmistakable Atmosphere.` },
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <PressStrip />
      <Statement />
      <LazyHydrate id="story">
        <Cover>
          <StoryBlock />
        </Cover>
      </LazyHydrate>
      <LazyHydrate id="space">
        <SpaceReveal />
      </LazyHydrate>
      <LazyHydrate id="night">
        <NightStory />
      </LazyHydrate>
      <LazyHydrate id="showcase">
        <Cover>
          <Showcase />
        </Cover>
      </LazyHydrate>
      <LazyHydrate id="events">
        <EventsTrack />
      </LazyHydrate>
      <LazyHydrate id="gallery">
        <GalleryTeaser />
      </LazyHydrate>
      <LazyHydrate id="enquire" minHeight="90svh">
        <ReserveCta />
      </LazyHydrate>
    </>
  );
}
