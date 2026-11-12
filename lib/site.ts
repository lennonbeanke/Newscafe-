import type { NavLink } from "@/types";

/**
 * Single source of truth for brand + contact details.
 * Everything below is placeholder copy — replace with the venue's real details.
 */
export const site = {
  name: "News Cafe",
  tagline: "Good food. Great cocktails. Unmistakable atmosphere.",
  hashtag: "#ItsAboutTheVibe",
  description:
    "News Cafe: good food, great cocktails and unmistakable atmosphere. Browse the breakfast, food and cocktail menus, catch our promos and book your year-end function.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.newscafe.co.za",
  /** Hero background video + its poster frame (see public/videos/CREDITS.txt). */
  heroVideo: "/videos/hero.mp4",
  /** Lighter 640×360 cut served to small screens. */
  heroVideoMobile: "/videos/hero-mobile.mp4",
  heroPoster: "/videos/hero-poster.jpg",
  /** Head office. */
  address: {
    street: "2 Rutland Mews, Cnr. Main & Keymer Roads",
    suburb: "Eastleigh",
    city: "Edenvale",
    region: "Gauteng",
    postal: "1609",
    country: "ZA",
  },
  phone: "+27 11 452 8770",
  email: "info@newscafe.co.za",
  legal: "News Cafe is a registered trademark of Fournews (Pty) Ltd. Reg. No 95/13839/07",
  ageNotice: "Alcohol Not For Persons Under The Age Of 18 | Drink Responsibly.",
  social: {
    instagram: "https://instagram.com/",
    facebook: "https://facebook.com/",
    tiktok: "https://tiktok.com/",
  },
} as const;

export const navLinks: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Menu", href: "/menu" },
  { label: "Promos", href: "/events" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export const fullAddress = `${site.address.street}, ${site.address.suburb}, ${site.address.city}, ${site.address.postal}`;
