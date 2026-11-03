import type { Metadata } from "next";
import { PageHero } from "@/components/layout/PageHero";
import { Manifesto } from "@/components/sections/about/Manifesto";
import { Timeline } from "@/components/sections/about/Timeline";
import { Values } from "@/components/sections/about/Values";
import { ReserveCta } from "@/components/sections/home/ReserveCta";
import { photo } from "@/lib/images";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Us — It's About the Vibe",
  description:
    "Good food. Great cocktails. Unmistakable atmosphere. Learn what News Cafe is all about, from breakfast to the last round.",
  alternates: { canonical: "/about" },
  openGraph: { url: "/about", title: `About — ${site.name}` },
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Us"
        title="It's about the *vibe*"
        subtitle="Good food. Great cocktails. Unmistakable atmosphere."
        image={photo("barDark", 2400)}
        alt="Warmly lit bar interior"
      />
      <Manifesto />
      <Timeline />
      <Values />
      <ReserveCta />
    </>
  );
}
