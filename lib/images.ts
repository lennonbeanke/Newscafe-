import { img } from "./utils";

/**
 * Curated photography, referenced by Unsplash id. Swap these for the venue's own
 * photography (drop files in /public/images and return local paths instead).
 */
export const photos = {
  barWide: "1572116469696-31de0f17cc34",
  barDark: "1578474846511-04ba529f0b88",
  barRustic: "1514933651103-005eec06c04b",
  dining: "1517248135467-4c7edcad34c4",
  diningRoom: "1550966871-3ed3cdb5ed0c",
  terrace: "1559339352-11d035aa65de",
  chef: "1541614101331-1a5a3a194e92",
  whiskey: "1470337458703-46ad1756a187",
  darkCocktail: "1536935338788-846bb9981813",
  bartender: "1566417713940-fe7c737a9ef2",
  trio: "1551024709-8f23befc6f87",
  martini: "1544145945-f90425340c7e",
  wine: "1519671482749-fd09be7ccebf",
  toast: "1527529482837-4698179dc6ce",
  plated: "1414235077428-338989a2e8c0",
  shared: "1504674900247-0877df9cc836",
  steak: "1600891964092-4316c288032e",
  dessert: "1624353365286-3f8d62daad51",
  dj: "1470225620780-dba8ba36b745",
  crowdStage: "1516450360452-9312f5e86fc7",
  hands: "1429962714451-bb934ecdc4ec",
  confetti: "1492684223066-81342ee5ff30",
  lights: "1514525253161-7a46d19cd819",
  redNight: "1545128485-c400e7702796",
} as const;

export type PhotoKey = keyof typeof photos;

export const photo = (key: PhotoKey, width = 1600) => img(photos[key], width);
