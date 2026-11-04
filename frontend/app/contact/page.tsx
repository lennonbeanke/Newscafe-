import type { Metadata } from "next";
import { PageHero } from "@/components/layout/PageHero";
import { Info } from "@/components/sections/contact/Info";
import { ReservationForm } from "@/components/sections/contact/ReservationForm";
import { MapEmbed } from "@/components/sections/contact/MapEmbed";
import { photo } from "@/lib/images";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact — Head Office & Enquiries",
  description: `Get in touch with ${site.name}: head office address, phone, email and map. To book a function, email ${site.email}.`,
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact", title: `Contact — ${site.name}` },
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Get in *touch*"
        subtitle="Questions, feedback or a function to book? Send us a message and we'll get back to you."
        image={photo("barRustic", 2400)}
        alt="Bar with hanging lights and rows of bottles"
      />
      <section className="py-24 md:py-40">
        <div className="container-x grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Info />
          </div>
          <div className="lg:col-span-7">
            <ReservationForm />
          </div>
        </div>
      </section>
      <MapEmbed />
    </>
  );
}
