import type { EventItem, GalleryItem, Milestone } from "@/types";
import { photo } from "./images";

/** Promos, taken from News Cafe's own announcements. */
export const events: EventItem[] = [
  {
    id: "rush-hour",
    title: "Rush Hour",
    kind: "Promo",
    day: "RUSH",
    month: "Hour",
    blurb: "Somewhere between golden hour & one more round. That's where you'll find us.",
    image: photo("terrace"),
  },
  {
    id: "year-end",
    title: "Year-End Functions",
    kind: "Functions",
    day: "YEAR",
    month: "End",
    blurb: "Bring the team together for a celebration like no other. Email info@newscafe.co.za to make a booking.",
    image: photo("toast"),
  },
  {
    id: "summer-menu",
    title: "The New Summer Food Menu",
    kind: "Menu",
    day: "NEW",
    month: "Menu",
    blurb: "Our new food menu is live and summer at News Cafe is looking delicious. Come find your new favourites.",
    image: photo("steak"),
  },
  {
    id: "glenfiddich",
    title: "Glenfiddich at News Cafe",
    kind: "Bar",
    day: "BAR",
    month: "Whisky",
    blurb: "Whether you choose a classic double or the Orchid Mist cocktail, experience Glenfiddich at News Cafe.",
    image: photo("whiskey"),
  },
  {
    id: "full-treatment",
    title: "The Full Treatment",
    kind: "Promo",
    day: "NIGHT",
    month: "Out",
    blurb: "When the night deserves the full treatment, make your next evening a News Cafe affair.",
    image: photo("bartender"),
  },
];

export const gallery: GalleryItem[] = [
  { id: "g1", src: photo("barWide", 1400), alt: "Bar glowing with amber pendant lights", category: "Venue", ratio: 4 / 5 },
  { id: "g2", src: photo("darkCocktail", 1400), alt: "Dark berry cocktail with dried citrus garnish", category: "Cocktails", ratio: 3 / 2 },
  { id: "g3", src: photo("dj", 1400), alt: "DJ mixing under neon light", category: "Nights", ratio: 4 / 5 },
  { id: "g4", src: photo("steak", 1400), alt: "Dry-aged steak with hand-cut fries", category: "Food", ratio: 1 },
  { id: "g5", src: photo("dining", 1400), alt: "Moody dining room with leather banquettes", category: "Venue", ratio: 3 / 2 },
  { id: "g6", src: photo("whiskey", 1400), alt: "Bourbon poured over a clear ice sphere", category: "Cocktails", ratio: 4 / 5 },
  { id: "g7", src: photo("crowdStage", 1400), alt: "Crowd in front of a lit stage", category: "Nights", ratio: 3 / 2 },
  { id: "g8", src: photo("plated", 1400), alt: "Plated courses on a candle-lit table", category: "Food", ratio: 4 / 5 },
  { id: "g9", src: photo("trio", 1400), alt: "Three signature cocktails on a glowing bar top", category: "Cocktails", ratio: 1 },
  { id: "g10", src: photo("terrace", 1400), alt: "Terrace tables overlooking the water at dusk", category: "Venue", ratio: 3 / 2 },
  { id: "g11", src: photo("confetti", 1400), alt: "Confetti falling over a cheering crowd", category: "Nights", ratio: 4 / 5 },
  { id: "g12", src: photo("dessert", 1400), alt: "Chocolate fondant with vanilla ice cream", category: "Food", ratio: 1 },
  { id: "g13", src: photo("bartender", 1400), alt: "Bartender pouring under purple light", category: "Cocktails", ratio: 3 / 2 },
  { id: "g14", src: photo("lights", 1400), alt: "Laser lights across the dance floor", category: "Nights", ratio: 4 / 5 },
  { id: "g15", src: photo("barRustic", 1400), alt: "Chalkboard menus and bottles behind the main bar", category: "Venue", ratio: 1 },
  { id: "g16", src: photo("martini", 1400), alt: "Martini glasses catching warm light", category: "Cocktails", ratio: 4 / 5 },
];

/** "A day at News Cafe" stages, used on the About page timeline. Copy is drawn from News Cafe's own announcements. */
export const milestones: Milestone[] = [
  { year: "Breakfast", title: "Start the day right", text: "The breakfast menu is where News Cafe mornings begin." },
  { year: "Food", title: "New flavours. New favourites.", text: "The new summer food menu is live, so come and find your favourites." },
  { year: "Rush Hour", title: "Golden hour & one more round", text: "Somewhere between golden hour and one more round. That's where you'll find us." },
  { year: "Functions", title: "A celebration like no other", text: "Bring the team together for a year-end celebration. Email info@newscafe.co.za to book." },
];

/** Brand phrases for the marquees. */
export const phrases = [
  "Good food",
  "Great cocktails",
  "Unmistakable atmosphere",
  "#ItsAboutTheVibe",
  "Rush Hour",
  "Orchid Mist",
  "Year-end functions",
  "Breakfast",
];
