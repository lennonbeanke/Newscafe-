import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import { site } from "@/lib/site";
import { TransitionProvider } from "@/components/providers/TransitionProvider";
import { SmoothScroll } from "@/components/providers/SmoothScroll";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { DesktopFx } from "@/components/ui/DesktopFx";
import { LazyHydrate } from "@/components/ui/LazyHydrate";
import { JsonLd } from "@/components/ui/JsonLd";
import { DistortDefs } from "@/components/ui/Distort";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { THEME_COLORS, themeInitScript } from "@/lib/theme";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const viewport: Viewport = {
  // Browser UI colour follows the device until the visitor picks a theme (the toggle then overrides it).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "dark light",
};

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: ["News Cafe", "restaurant", "cocktails", "breakfast", "year-end functions", "Gauteng", "South Africa"],
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: "/",
    locale: "en_ZA",
    images: [
      {
        url: "https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&w=1200&h=630&q=80",
        width: 1200,
        height: 630,
        alt: `${site.name}: good food, great cocktails, unmistakable atmosphere`,
      },
    ],
  },
  twitter: { card: "summary_large_image", title: site.name, description: site.description },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site.name,
  description: site.description,
  url: site.url,
  telephone: site.phone,
  email: site.email,
  parentOrganization: { "@type": "Organization", name: "Fournews (Pty) Ltd" },
  address: {
    "@type": "PostalAddress",
    streetAddress: site.address.street,
    addressLocality: `${site.address.suburb}, ${site.address.city}`,
    addressRegion: site.address.region,
    postalCode: site.address.postal,
    addressCountry: site.address.country,
  },
  sameAs: Object.values(site.social),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint so the wrong theme never flashes */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <JsonLd data={organizationSchema} />
        <DistortDefs />
        <MotionProvider>
          <TransitionProvider>
            <SmoothScroll>
              <a
                href="#main"
                className="fixed left-4 top-4 z-[200] -translate-y-24 rounded-full bg-gold px-5 py-3 text-xs font-bold uppercase tracking-widest text-ink focus:translate-y-0"
              >
                Skip to content
              </a>
              <Navbar />
              <main id="main">{children}</main>
              <LazyHydrate id="footer" minHeight="70svh" margin="60% 0px">
                <Footer />
              </LazyHydrate>
              <DesktopFx />
            </SmoothScroll>
          </TransitionProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
