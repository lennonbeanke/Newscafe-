/** Real News Cafe photography, cropped from cocktails_april-2026_updated.pdf (see public/menu). */
export interface MenuPhoto {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export const menuPhotos = {
  hero: { src: "/menu/hero.jpg", width: 2043, height: 1335, alt: "A frozen Coral Breeze cocktail garnished with smoking rosemary" },
  rush: { src: "/menu/rush.jpg", width: 1100, height: 2307, alt: "Rush Hour cocktails: Coco Mambo, Faithful Bitch, Mojito, Long Island Ice Tea and Watermelon Sugar" },
  signature: { src: "/menu/signature.jpg", width: 900, height: 2483, alt: "Drops of Juniper, a sparkling pink and purple signature cocktail" },
  originals: { src: "/menu/originals.jpg", width: 683, height: 2268, alt: "Glimmer & Glow, a glitter cocktail in a tall flute" },
  classics: { src: "/menu/classics.jpg", width: 1500, height: 929, alt: "A Negroni and a Pina Colada on a purple backdrop" },
  paired: { src: "/menu/paired.jpg", width: 1100, height: 1459, alt: "Hugo, Aperol and Mexican spritzes" },
  whisky: { src: "/menu/whisky.jpg", width: 1100, height: 1459, alt: "The Glenlivet 15 and Johnnie Walker Blue Label beside a glass of whisky" },
  spirits: { src: "/menu/spirits.jpg", width: 1500, height: 1223, alt: "Don Julio Añejo, Hendrick's Gin and Martell Blue Swift" },
  vodka: { src: "/menu/vodka.jpg", width: 800, height: 2141, alt: "A bottle of Rémy Martin V.S" },
  bubbles: { src: "/menu/bubbles.jpg", width: 1500, height: 1201, alt: "A glass of bubbles beside a bottle of Boschendal Brut" },
} satisfies Record<string, MenuPhoto>;

/** Which cocktail-menu sections get a photograph, and how it is laid out. */
export const sectionPhotos: Record<string, { photo: MenuPhoto; layout: "side-left" | "side-right" | "wide" }> = {
  originals: { photo: menuPhotos.originals, layout: "side-right" },
  "classics-cocktails": { photo: menuPhotos.classics, layout: "wide" },
  paired: { photo: menuPhotos.paired, layout: "side-left" },
  whisky: { photo: menuPhotos.whisky, layout: "side-right" },
  cognac: { photo: menuPhotos.spirits, layout: "wide" },
  vodka: { photo: menuPhotos.vodka, layout: "side-left" },
  bubbles: { photo: menuPhotos.bubbles, layout: "wide" },
};
