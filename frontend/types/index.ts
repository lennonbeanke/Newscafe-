export interface NavLink {
  label: string;
  href: string;
}

/** One labelled price, e.g. { label: "Glass", amount: 70 }. */
export interface MenuPrice {
  label: string;
  amount: number;
}

export interface MenuEntry {
  name: string;
  description?: string;
  /** Single price in Rand. */
  price?: number;
  /** Several prices (Glass | Bottle, Glass | Carafe …). Only the prices printed on the original menu are listed. */
  prices?: MenuPrice[];
  /** Printed "(v)" on the original menu. */
  vegetarian?: boolean;
  /** Extra line printed with the item, e.g. "Served smoked". */
  note?: string;
  /** "Alcohol free if you wish" variant and its price. */
  alcoholFree?: number;
  /** "Trade Up" upgrade shown on the original, with its own price. */
  tradeUp?: { name: string; price: number };
  /** Optional extras, e.g. "Add salmon +55". */
  addOns?: MenuPrice[];
  /** Carries the printed "N" badge. The meaning of the badge is NOT confirmed, so it is never shown (see MENU_FLAG_ENABLED). */
  marked?: boolean;
}

export interface MenuGroup {
  title?: string;
  note?: string;
  entries: MenuEntry[];
}

export interface MenuSection {
  id: string;
  title: string;
  subtitle?: string;
  note?: string;
  /** Column headings when the section prices two ways (["Glass", "Bottle"]). */
  priceLabels?: [string, string];
  groups: MenuGroup[];
}

export interface MenuBook {
  id: "breakfast" | "food" | "cocktails" | "functions";
  label: string;
  tagline: string;
  sections: MenuSection[];
}

export interface SetMenu {
  id: string;
  title: string;
  price: number;
  includes: string;
  courses: { title: string; items: { name: string; description?: string; vegetarian?: boolean }[] }[];
}

export type EventKind = "Promo" | "Menu" | "Bar" | "Functions";

export interface EventItem {
  id: string;
  title: string;
  kind: EventKind;
  /** Large label on the card, e.g. "RUSH". */
  day: string;
  /** Small label beneath it, e.g. "Hour". */
  month: string;
  blurb: string;
  image: string;
}

export type GalleryCategory = "Cocktails" | "Food" | "Venue" | "Nights";

export interface GalleryItem {
  id: string;
  src: string;
  alt: string;
  category: GalleryCategory;
  /** width / height */
  ratio: number;
}

export interface Milestone {
  /** Short label shown in place of a year, e.g. "Breakfast". */
  year: string;
  title: string;
  text: string;
}
