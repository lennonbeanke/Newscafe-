import type { Metadata } from "next";
import { PageHero } from "@/components/layout/PageHero";
import { GalleryReel } from "@/components/sections/gallery/GalleryReel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ReserveCta } from "@/components/sections/home/ReserveCta";
import { photo } from "@/lib/images";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Gallery — Catch Our Vibe",
  description:
    "Good food, great cocktails and the atmosphere in between. Browse the News Cafe gallery.",
  alternates: { canonical: "/gallery" },
  openGraph: { url: "/gallery", title: `Gallery — ${site.name}` },
};

export default function GalleryPage() {
  return (
    <>
      <PageHero
        eyebrow="Gallery"
        title="Catch our *vibe*"
        subtitle="Good food, great cocktails and the atmosphere in between."
        image={photo("lights", 2400)}
        alt="Laser lights over the dance floor"
      />
      <section className="overflow-hidden pb-6 pt-24 md:pt-36">
        <div className="container-x mb-14">
          <SectionHeading eyebrow="The Reel" title="Drag. Flick. *Drift.*" />
        </div>
        <GalleryReel rows={1} />
      </section>
      <ReserveCta />
    </>
  );
}
