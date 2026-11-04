import type { MenuBook, MenuEntry, MenuGroup, MenuSection, SetMenu } from "@/types";

/**
 * News Cafe menus, transcribed from the original PDFs (cocktails_april-2026_updated.pdf, news-cafe_breakfast-menu_2026.pdf,
 * news-cafe-food-menu-2026.pdf, news-cafe-functions-menu.pdf). Prices are Rand and exactly as printed.
 *
 * - Item and drink names are kept as printed (only letter-case is normalised for display).
 * - Obvious spelling errors in descriptions are corrected ("Liquer" → "Liqueur").
 * - `marked: true` records the printed "N" badge. Its meaning is not explained anywhere in the PDFs, so it is not shown
 *   until confirmed (see MENU_FLAG_ENABLED).
 */

/** Flip to true once the meaning of the printed "N" badge has been confirmed. */
export const MENU_FLAG_ENABLED = false;
/** Label to show for the badge once confirmed (e.g. "New"). */
export const MENU_FLAG_LABEL = "";

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
const item = (name: string, price: number | undefined, description?: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  name,
  ...(description ? { description } : {}),
  ...(price !== undefined ? { price } : {}),
  ...extra,
});
const N = { marked: true } as const;
const V = { vegetarian: true } as const;
/** Spirit / wine row: glass | bottle (either may be absent on the original). */
const gb = (name: string, glass: number | undefined, bottle: number | undefined, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  name,
  prices: [
    ...(glass !== undefined ? [{ label: "Glass", amount: glass }] : []),
    ...(bottle !== undefined ? [{ label: "Bottle", amount: bottle }] : []),
  ],
  ...extra,
});
const group = (entries: MenuEntry[], title?: string, note?: string): MenuGroup => ({ ...(title ? { title } : {}), ...(note ? { note } : {}), entries });
const section = (s: MenuSection): MenuSection => s;

const TOAST = "Toast options: White | Brown | Health | Sourdough";
const SIDES_FOOD = "Sides: Onion Rings | Chips | Side Salad | Parmesan Mash | Potato Wedges | Grilled Seasonal Veg | Sweet Potato Fries | Cheesy Pap Balls & Chakalaka";
const GLASS_BOTTLE: [string, string] = ["Glass", "Bottle"];

// ── shared drinks (printed on both the Breakfast and Food menus) ──────────────────────────────────────────────────
const coffee = (): MenuGroup =>
  group(
    [
      item("Americano", 36),
      item("Cortado", 37),
      item("Cappuccino", 40),
      item("Grande Cappuccino", 46, "Double shot espresso"),
      item("Single Espresso", 28),
      item("Caffe Latte", 44),
      item("Caffe Mocha", 49),
      item("Dirty Chai Latte", 58, "Chai, espresso & steamed milk"),
    ],
    "Coffee",
    "Decaf +6 | Add Cream +10 | Almond OR Oat Milk +14",
  );
const hot = (): MenuGroup =>
  group(
    [
      item("Coconut Matcha Latte", 52),
      item("Belgian Hot Chocolate", 49),
      item("Rooibos Cappuccino", 40),
      item("Rooibos Latte", 42),
      item("Spicy Chai Latte", 46),
    ],
    "Hot",
  );
const tea = (): MenuGroup => group([item("Dilmah Green Moroccan Mint", 40), item("Rooibos | Ceylon", 32)], "Tea");

// ── BREAKFAST ────────────────────────────────────────────────────────────────────────────────────────────────────
const breakfast: MenuBook = {
  id: "breakfast",
  label: "Breakfast",
  tagline: "Start the day the News Cafe way.",
  sections: [
    section({
      id: "breakfast-plates",
      title: "Breakfast",
      note: TOAST,
      groups: [
        group([
          item("Italian Eggs", 120, "2 Poached eggs, 2 pork sausages in an Italian tomato-based sauce with mozzarella, parmesan cheese & toasted sourdough", N),
          item("Smashed Avo Sunrise", 98, "Poached egg, smashed avo, grilled cherry tomatoes, crumbled feta, chilli & micro herbs on toasted sourdough with a sesame bagel sprinkle", {
            ...V,
            addOns: [
              { label: "Add salmon", amount: 55 },
              { label: "Add bacon", amount: 28 },
            ],
          }),
          item("Smoked Salmon Hash", 139, "Smoked salmon on hash browns with a poached egg, lemon-dill creme fraiche & a rocket, red onion & parmesan salad", {
            addOns: [
              { label: "Add poached egg", amount: 12 },
              { label: "Add avo", amount: 25 },
            ],
          }),
          item("Scrambled Egg & Chorizo", 98, "Scrambled egg, chorizo & grilled cherry tomatoes on toasted sourdough"),
          item("Croissant French Toast", 95, "Cinnamon dusted, with maple bacon & whipped cream", N),
          item("Egg, Chorizo & Avo Toast", 89, "Smashed avo, sliced chorizo, poached egg with sesame bagel sprinkle on toasted croissant loaf", N),
        ]),
        group(
          [
            item("Smoked salmon, cream cheese, rocket & dill", 145, undefined, N),
            item("Scrambled egg & bacon, avo & basil pesto", 125, undefined, N),
          ],
          "Croissant Bagel",
        ),
      ],
    }),
    section({
      id: "benedicts",
      title: "Benedicts",
      groups: [
        group(
          [item("Classic", 99, "Hickory ham OR spinach & feta"), item("Boerie", 125, "Boerewors spirals & chakalaka", N)],
          undefined,
          "2 Poached eggs on an English muffin, with hollandaise sauce & grilled cherry tomatoes",
        ),
      ],
    }),
    section({
      id: "omelettes",
      title: "Omelettes",
      subtitle: "With toast",
      note: TOAST,
      groups: [
        group([
          item("Spicy jalapeno mince with corn, sliced avo & tomato salsa", 129, undefined, N),
          item("Spinach, feta, mushroom, mozzarella & caramelised red onion", 120),
          item("Bacon, mushroom & cheddar cheese", 99),
        ]),
      ],
    }),
    section({
      id: "classics",
      title: "Classics",
      note: TOAST,
      groups: [
        group([
          item("Farmhouse", 159, "2 Eggs, streaky OR back bacon, 2 pork sausages, spicy baked beans, with chips, toast & a grilled tomato"),
          item("Traditional", 155, "2 Eggs, streaky OR back bacon, boerewors spiral, mushrooms, with chips, toast & a grilled tomato"),
          item("English", 98, "2 Eggs, streaky OR back bacon with chips, toast & a grilled tomato"),
          item("Full House", 169, "2 Eggs, streaky OR back bacon, boerewors spiral, 2 pork sausages, grilled chorizo, with chips, toast & a grilled tomato"),
          item("Breakfast Royale", 120, "2 Poached eggs, streaky bacon, avo, rocket, grilled cherry tomatoes & toasted sourdough"),
          item("Hangover Fried Rice", 98, "Egg fried brown rice, chilli mince, mixed peppers, red onion, soy sauce & a fried egg"),
          item("Oats", 65, "Sliced banana, sliced apple, honey & cinnamon", V),
        ]),
      ],
    }),
    section({
      id: "breakfast-drinks",
      title: "Drinks",
      groups: [
        group([{ name: "Mimosa", prices: [{ label: "Glass", amount: 70 }, { label: "Carafe", amount: 199 }], note: "Served from 10am" }], "Mimosa"),
        coffee(),
        hot(),
        tea(),
        group(
          [
            item("Iced Latte", 45),
            item("Iced Strawberry Matcha", 58, undefined, N),
            item("Coffee Freezo", 57),
            item("Mineral Water", 30, "500ml – Still | Sparkling"),
            item("Fresh Juice", 45, "Grapefruit | Pressed Apple | Pineapple | Orange | Mango | Cranberry"),
          ],
          "Cold",
        ),
        group(
          [
            item("Tropical Twist", 75, "Mango, pineapple, passion fruit, orange, turmeric & ginger", N),
            item("Green-Up", 75, "Banana, spinach, kiwi, ginger & mango", N),
            item("Peanut Power", 75, "Peanut butter, banana, honey, oats & yoghurt"),
            item("Berry Burst", 70, "Mixed berries, vanilla, honey, yoghurt & chia seeds", N),
          ],
          "Smoothies",
        ),
      ],
    }),
  ],
};

// ── FOOD ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const food: MenuBook = {
  id: "food",
  label: "Food",
  tagline: "New flavours. New favourites.",
  sections: [
    section({
      id: "cafe",
      title: "Café",
      // The original prints these under one "Café" heading; the sub-group labels are descriptive only.
      groups: [
        group(
          [
            item("Chicken Caesar Tacos", 120, "Soft shell tacos with cos lettuce, panko crumbed chicken & parmesan cheese tossed in caesar dressing", N),
            item("Cheeseburger Tacos", 128, "Pressed burger soft shell tacos with cheddar cheese, shredded lettuce, chopped tomatoes, red onion, gherkins & jalapeno mayo"),
          ],
          "Tacos",
        ),
        group(
          [
            item("Prawn & Avo Salad", 189, "4 Queen prawns grilled with lemon butter & chilli, shredded red cabbage, baby leaf lettuce, cucumber, carrot ribbons, cherry tomatoes, avo with sesame bagel sprinkle & spicy mayo dressing"),
            item("Cajun Chicken & Corn Salad", 159, "Cajun spiced chicken, rocket, pickled red onion, corn, pepper & pineapple salsa, cucumber ribbons, corn ribs, avo, piquante peppers & spinach crisps with a honey mustard dressing"),
          ],
          "Salads",
        ),
        group(
          [
            item("Crispy Chicken Bao", 165, "Steamed bao buns with panko crumbed chicken, tossed in sweet chilli soya sauce with sesame seeds, spring onion, cucumber, zesty red cabbage & kewpie mayo"),
            item("Pork Belly Bao", 175, "Steamed bao buns with sticky pork belly, sesame seeds, red peppers, spring onion, coriander & rocket"),
          ],
          "Bao",
        ),
        group(
          [
            item("Hot Honey Sesame Chicken", 169, "Grilled honey & sriracha deboned chicken thighs with sauteed broccoli stems, crushed butternut & spinach crisps"),
            item("Chicken Schnitzel", 139, "With cream cheese, avo, honey mustard dressing & potato wedges"),
            item("Peri-Peri Chicken Livers", 99, "With toasted ciabatta"),
            item("Butter Chicken Curry", 175, "Aromatic curry with basmati rice, sambals & naan bread"),
          ],
          "Mains",
        ),
        group(
          [
            item("Seafood Linguine Pasta", 229, "Queen prawns, grilled calamari & mussels, in a creamy white wine, garlic, red chilli & dill sauce with grilled cherry tomatoes & linguine"),
            item("Chicken Liver Pasta", 139, "Creamy peri-peri chicken livers, green peppers, with parmesan cheese & linguine", N),
            item("Zucchini & Mushroom Pasta", 129, "Piquante peppers, chopped rocket, olive oil, garlic & lemon zest with linguine", V),
            item("Calamari & Chorizo Pasta", 175, "Grilled calamari, chorizo, chilli, cherry tomatoes, basil, lemon, olive oil & parmesan cheese with linguine"),
          ],
          "Pasta",
        ),
      ],
    }),
    section({
      id: "burgers",
      title: "Burgers",
      subtitle: "BBQ basted beef patty with a side",
      note: "Sides: Onion Rings | Chips | Side Salad | Potato Wedges | Sweet Potato Fries",
      groups: [
        group([
          item("The Headliner", 289, "Double wagyu patty, mature cheddar, rocket, streaky bacon & grilled lemon butter prawns", N),
          item("Big Beef Burger", 279, "Double wagyu patty, cheddar cheese, streaky bacon, avo, caramelised red onion, mushroom sauce, lettuce, tomato & onion rings", N),
          item("Reverse Cheese", 195, "Double patty, cheddar cheese, red onion, gherkins, smothered in sriracha cheese sauce & dried onion flakes"),
          item("Chilli Cheese Popper", 175, "Guacamole, jalapeno popper melt, nacho crunch, red onion, lettuce & tomato"),
          item("Original BBQ", 135, "Red onion, lettuce & tomato"),
          item("Classic Cheese", 145, "Cheddar cheese, red onion, lettuce & tomato"),
          item("Cheese & Bacon", 158, "Bacon, cheddar cheese, red onion, lettuce & tomato"),
          item("Hot Honey Chicken", 135, "Southern style fried chicken breast tossed in hot honey, gherkins, shredded lettuce & ranch dip"),
        ]),
      ],
    }),
    section({
      id: "sandwiches",
      title: "Sandwiches",
      groups: [
        group([
          item("Pork Belly Sando", 139, "Grilled pork belly, spicy mayo slaw, pickled red onion, coriander, sesame bagel sprinkle on toasted brioche", N),
          item("Korean Chicken Sando", 129, "Panko crumbed chicken breast, coleslaw, gherkins, sweet & spicy Korean sauce, kewpie mayo & sesame bagel sprinkle on toasted brioche", N),
          item("The Club", 159, "Panko crumbed chicken breast, hickory ham, mature white cheddar, tomato, lettuce, crispy bacon & mayo between 3 slices of toast with chips"),
          item("Grilled Chicken Avo-naise", 110, "Shredded grilled chicken, avo-naise & spring onion with microgreens & parmesan on toasted sourdough with chips"),
          item("Hickory Ham & Cheddar", 98, "Ham & mature white cheddar with mustard mayo on toasted sourdough with chips"),
        ]),
      ],
    }),
    section({
      id: "tapas",
      title: "Tapas",
      subtitle: "Choose a few to share OR just for you",
      groups: [
        group([
          item("Korean Fried Cauliflower", 95, "Tossed in sweet chilli soy, with spicy mayo", { ...V, ...N }),
          item("Butter Chicken Cheese Bombs", 120, "Panko-crumbed butter chicken with mozzarella cheese, yoghurt, sambals & a sesame bagel sprinkle", N),
          item("Chicken Potstickers", 95, "With spring onion, chopped chilli & sweet soy dip", N),
          item("Pap & Wors", 139, "Boerewors spirals topped with cheesy pap balls & chakalaka"),
          item("Buffalo Wings", 169, "Hot buffalo OR hot honey OR Korean BBQ tossed, with onion rings & ranch dip"),
          item("Bacon & Chorizo Bombs", 120, "Jalapeno popper mix & cheddar cheese, wrapped with bacon & chorizo"),
          item("Dynamite Prawns", 159, "Tempura battered prawns, tossed in dynamite sauce"),
          item("White Wine Mussels", 145, "Half shell mussels in a creamy white wine, garlic, dill & parmesan sauce, with ciabatta", N),
          item("Crispy Pork Bites", 148, "Tossed in sweet sticky sauce, with sesame bagel sprinkle"),
          item("Salt & Pepper Squid", 120, "Lightly battered & fried, with jalapeno mayo"),
          item("Loaded Fries", 95, "Bacon, cheddar & mozzarella cheese"),
          item("Loaded Fries", 115, "Crispy sweet chilli soy chicken, cheddar cheese & spring onion", N),
          item("Corn Ribs", 69, "With ranch dip, crispy onion & parmesan", V),
          item("Calamari & Chorizo", 110, "With chilli & harissa lemon butter"),
          item("Nachos", 119, "Chilli cheese sauce, jalapenos, melted cheddar & mozzarella cheese, with guacamole, sour cream & salsa", {
            ...V,
            addOns: [
              { label: "Add chicken strips", amount: 40 },
              { label: "Add chorizo", amount: 45 },
            ],
          }),
          item("Tapas Board", 298, "Korean fried cauliflower, salt & pepper squid, corn ribs, bacon & chorizo bombs, chicken bites & honey mustard mayo"),
        ]),
      ],
    }),
    section({
      id: "platters",
      title: "Platters",
      subtitle: "Serves 3-4",
      groups: [
        group([
          item("The Luxe", 940, "8 Grilled queen prawns, crispy pork bites, 300g sliced rump with Jameson mushroom sauce, peri-peri chicken wings, bacon & cheese loaded fries & onion rings", N),
          item("The Boss", 890, "500g BBQ pork ribs, BBQ chicken wings, peri-peri chicken wings, nachos & 300g sliced rump with onion rings & a mixed pepper, corn & spring onion salsa"),
          item("News", 470, "Chicken bites, BBQ chicken skewers, Korean fried cauliflower, bockwurst, potato wedges, with BBQ sauce & honey mustard mayo"),
          item("Seafood", 690, "8 Grilled queen prawns, white wine mussels, grilled OR fried calamari, fried hake bites with lemon butter sauce, jalapeno mayo, potato wedges & a side salad"),
          item("The Top Seller", 680, "500g BBQ pork ribs, BBQ chicken wings, chicken bites, bockwurst, potato wedges with BBQ sauce & honey mustard mayo"),
          item("Boss Platter & Rémy Martin V.S", 2390),
        ]),
      ],
    }),
    section({
      id: "signature-steaks",
      title: "Signature Steaks",
      note: "With a side",
      groups: [
        group([
          item("Flaming Tomahawk (to share)", 790, "Flambeed & served tableside. 1kg Tomahawk, with parmesan mash, grilled seasonal veg & your choice of sauce (Allow extra time for preparation)"),
          item("Jalapeno Popper Melt", 320, "400g Rib-eye on the bone, topped with a jalapeno popper melt, cheddar crust & crispy bacon"),
          item("Rump & Livers", 279, "300g Rump topped with peri-peri chicken livers"),
          item("Fillet & Marrow", 298, "250g Beef fillet, with a lemon & herb crumb roasted bone marrow"),
          item("Rib-Eye Linguine", 340, "400g Sliced rib-eye on the bone, with a mushroom, cream & parmesan linguine", N),
        ]),
      ],
    }),
    section({
      id: "classic-steaks",
      title: "Classic Steaks",
      subtitle: "Biltong spiced, salt & pepper rubbed, OR BBQ basted with a side",
      note: `Add roasted bone marrow +38 with a lemon & herb crumb topping. ${SIDES_FOOD}. Sauces 45: Sriracha Cheese | Jameson Mushroom`,
      groups: [
        group([
          item("400g Rib-eye", 299, "On the bone"),
          item("300g Rump", 229),
          item("200g Sirloin", 179),
          item("500g T-Bone", 320),
        ]),
      ],
    }),
    section({
      id: "grills",
      title: "Grills & Favourites",
      subtitle: "With a side",
      note: SIDES_FOOD.replace("Parmesan Mash | ", "Parmesan Mash | "),
      groups: [
        group([
          item("Bourbon BBQ Beef Ribs", 398, "800g Bourbon & smokey BBQ basted", N),
          item("Greek Lamb Chops", 289, "3 Seasoned loin chops with creamy parmesan mash & sauteed broccoli stems", N),
          item("Peri-Peri Chicken Thighs", 199, "Peri-peri basted, deboned chicken thighs"),
          item("Cajun Calamari", 189, "Cajun grilled calamari, creamy lemon butter sauce", N),
          item("Queen Prawns", 289, "8 Grilled lemon butter basted prawns"),
          item("Hake & Chips", 198, "Grilled OR fried with jalapeno mayo", { addOns: [{ label: "Add 3 grilled queen prawns", amount: 95 }] }),
          item("Seafood for One", 299, "3 Grilled queen prawns, white wine mussels, grilled cajun calamari with jalapeno mayo"),
          item("BBQ Ribs", 298, "500g Pork ribs"),
          item("Ribs & Wings", 479, "BBQ OR peri-peri wings & 500g BBQ pork ribs"),
          item("Chicken Wings", 220, "BBQ OR peri-peri basted"),
        ]),
      ],
    }),
    section({
      id: "dessert",
      title: "Dessert",
      groups: [
        group([
          item("Baked Cheesecake", 120, "With meringue, strawberries & strawberry coulis"),
          item("Chocolate Brownie", 120, "Peanut brittle, espresso martini chocolate sauce & whipped cream OR ice cream"),
          item("Biscoff Malva Pudding", 115, "With a Biscoff & Kahlua coffee liqueur sauce & Biscoff crumble", N),
          item("Pistachio Choc Mousse Cake", 125, "With chocolate disc, crispy kataifi & whipped cream", N),
        ]),
      ],
    }),
    section({
      id: "food-drinks",
      title: "Drinks",
      groups: [
        coffee(),
        hot(),
        tea(),
        group(
          [
            item("Iced Latte", 45),
            item("Iced Strawberry Matcha", 58, undefined, N),
            item("Coffee Freezo", 57),
            item("Mineral Water", 30, "500ml – Still | Sparkling"),
            item("Fresh Juice", 45, "Grapefruit | Pressed Apple | Pineapple | Orange | Mango | Cranberry"),
            item("Milkshakes", 49, "Strawberry | Chocolate | Vanilla"),
            item("Tizers", 46, "Appletiser | Grapetiser"),
            item("Red Bull Energy Drink", 46, "Original | White Peach | Xero (zero sugar - low kilojoules)"),
            item("BOS Ice Tea", 44, "Peach | Lemon"),
          ],
          "Cold",
        ),
        group(
          [
            item("Yuzu Cranberry", 69, "Yuzu, lime & cranberry", N),
            item("Blueberry Citrus", 67, "Blueberry, cranberry & lemonade"),
            item("Tropical Passion", 69, "Kiwi, passionfruit, apple"),
          ],
          "Granitas",
          "Fruit & crushed ice",
        ),
      ],
    }),
  ],
};

// ── COCKTAILS ("Liquids") ────────────────────────────────────────────────────────────────────────────────────────
export const signatureCocktails: MenuSection = section({
  id: "signature-cocktails",
  title: "Signature Cocktails",
  groups: [
    group([
      item("Ripple Effect", 145, "Grey Goose Vodka, Cointreau Orange Liqueur, cranberry juice, pomegranate & agave foam"),
      item("The Don", 175, "Don Julio Blanco Tequila, lime juice, agave syrup & salt tincture"),
      item("Drops of Juniper", 139, "Bombay Sapphire Gin, lemon juice, rose, Martini Prosecco & butterfly blue pea, with cardamom tincture & citrus dust"),
      item("Parisian Sunset", 140, "Martell V.S Cognac, Cointreau Orange Liqueur, cranberry juice, lemon juice & vanilla", {
        ...N,
        tradeUp: { name: "Martell Blue Swift Cognac", price: 170 },
      }),
      item("Diablo", 140, "1800 Silver Tequila, passion fruit, vanilla, apple juice, sour mix & Schweppes Ginger Ale", N),
      item("The Ritual", 139, "Woodford Reserve Bourbon, Amaro, smokey whisky & complex syrup", { note: "Served smoked" }),
      item("King Pin", 175, "Hennessy V.S Cognac, pineapple, lemon juice & Schweppes Ginger Ale, with a gold dusted chocolate disk", {
        tradeUp: { name: "Hennessy V.S.O.P Cognac", price: 210 },
      }),
      item("Walking Tall", 125, "Johnnie Walker Blonde Whisky, passion fruit, lemon, rooibos espresso & Schweppes Ginger Ale", {
        tradeUp: { name: "Johnnie Walker Gold Label Whisky", price: 149 },
      }),
    ]),
  ],
});

const cocktails: MenuBook = {
  id: "cocktails",
  label: "Cocktails",
  tagline: "Great cocktails for the night that deserves the full treatment.",
  sections: [
    section({
      id: "originals",
      title: "News Cafe Originals",
      groups: [
        group([
          item("Glimmer & Glow", 99, "Glitter blend of El Jimador Blanco Tequila, Aperol, vanilla & cranberry juice"),
          item("Coral Breeze", 135, "Frozen blend of Aperol, passion fruit & lime, topped with Schweppes Grapefruit Soda"),
          item("Coco Mambo", 105, "La Machina Pineapple & Coconut Tequila, El Jimador Blanco Tequila, Butlers Triple Sec, sour mix & lime"),
          item("Watermelon Sugar", 110, "La Machina Watermelon Tequila, El Jimador Blanco Tequila, cherry & sour mix"),
          item("Triple Berry Smash", 139, "Jameson Triple Triple Whiskey, vanilla, mixed berries, soda & lime", N),
          item("Faithful Bitch", 95, "Smirnoff Vodka, Tang Apple Sours, Schweppes Lemonade, Grenadine & sour mix"),
          item("7 Deadly Sins", 139, "Jack Daniel's Tennessee Whiskey, Smirnoff Vodka, Amaretto Disaronno Liqueur, Southern Comfort Whiskey, Beefeater Gin, Butlers Triple Sec, Bacardi Carta Blanca Rum, lime, cranberry juice & orange juice"),
          item("Virgin Berry", 89, "Frozen mixed berries, mixed berry puree, mint, orange juice & Schweppes Lemonade", { note: "Alcohol free" }),
        ]),
      ],
    }),
    section({
      id: "classics-cocktails",
      title: "The Classics",
      groups: [
        group([
          item("Pornstar Martini", 149, "Grey Goose Vodka, vanilla, passion fruit, lime & Cinzano To-Spritz"),
          item("Old Fashioned", 120, "Buffalo Trace Bourbon, Vanilla & Orange Bitters"),
          item("New York Sour", 125, "The Singleton 12Yo Single Malt Whisky, sour mix & Durbanville Hills Merlot"),
          item("Negroni", 110, "Tanqueray London Dry Gin, Campari & Martini Rosso Vermouth"),
          item("Long Island Ice Tea", 119, "Bacardi Carta Blanca Rum, Smirnoff Vodka, Beefeater Gin, El Jimador Blanco Tequila, Butlers Triple Sec, sour mix, lime & Coca-Cola"),
          item("Pina Colada", 110, "Bacardi Carta Blanca Rum, fresh pineapple & coconut milk"),
          item("Mojito", 110, "Bacardi Carta Blanca Rum, mint complex syrup, limes, mint & soda", { alcoholFree: 80 }),
          item("Cosmopolitan", 98, "Absolut Lime Vodka, Butlers Triple Sec, lime & cranberry juice"),
          item("Strawberry Daiquiri", 119, "Bacardi Carta Blanca Rum, Butlers Strawberry Liqueur, strawberry juice, strawberry puree, lime, Grenadine & sour mix", { alcoholFree: 80 }),
          item("Bull Frog", 135, "Bacardi Carta Blanca Rum, Smirnoff Vodka, Beefeater Gin, El Jimador Blanco Tequila, Butlers Blue Curacao, sour mix, Red Bull Energy Drink & Schweppes Lemonade"),
          item("Classic Margarita", 110, "El Jimador Blanco Tequila, Butlers Triple Sec, lime juice & sour mix", { note: "Served shaken or frozen" }),
          item("Rosado Margarita", 149, "Patron Silver Tequila, Butlers Triple Sec, sour mix, rose & cranberry juice", { note: "Served shaken" }),
        ]),
      ],
    }),
    section({
      id: "paired",
      title: "Perfectly Paired",
      groups: [
        group([
          item("Mexican Spritz", 135, "La Machina Grapefruit Tequila, Aperol, Cinzano To-Spritz, soda & grapefruit"),
          item("Hugo Spritz", 135, "Beefeater Gin, Elderflower, Cinzano To-Spritz, soda, mint & lime", N),
          item("Aperol Spritz", 145, "Aperol, Cinzano To-Spritz, soda & orange"),
          item("Paloma", 125, "El Jimador Reposado Tequila, grapefruit juice & Schweppes Soda"),
          item("Bombay Sapphire Gin & Tonic", 99, "With Schweppes Indian Tonic & lime"),
          item("Tanqueray London Dry Gin & Tonic", 99, "With Schweppes Indian Tonic & grapefruit"),
          item("Watermelon Gin Bull", 125, "Beefeater Gin, Red Bull Red Edition Watermelon, lime & mint"),
          item("Absolut Vodka & Cranberry Juice", 95, "With lime"),
          item("Red Bull Twist", 85, "Lime, apple, Red Bull Energy Drink, mint, & soda water", { note: "Alcohol free" }),
          item("Ginger Monkey", 105, "Monkey Shoulder Whisky, Schweppes Ginger Ale & Orange Bitters"),
          item("Johnnie Walker Highball", 105, "Johnnie Walker Black Label Whisky, Schweppes Soda Water & rosemary"),
        ]),
      ],
    }),
    section({
      id: "shooters",
      title: "Shooters",
      groups: [
        group([
          item("Flaming Lamborghini", 145, "Butlers Blue Curacao, Butlers Strawberry Liqueur, Kahlua Coffee Liqueur, Sambuca, Stroh Rum & fresh cream"),
          item("Jagerbomb", 60, "Jägermeister & Red Bull Energy Drink"),
          item("Jelly Baby", 45, "Butlers Banana Liqueur, Butlers Blue Curacao, Strawberry Lips & Grenadine"),
          item("Mexican Blowjob", 45, "La Machina Coffee Tequila, Cape Velvet Original & fresh cream"),
          item("All Fall Down", 45, "Kahlua Coffee Liqueur, El Jimador Blanco Tequila & Stroh Rum"),
          item("Psychopath", 45, "Kahlua Coffee Liqueur, Amarula Cream Liqueur & Stroh Rum"),
          item("Liquid Cocaine", 60, "Smirnoff Vodka, Butlers Blue Curacao & lime", { note: "2 Double shots" }),
        ]),
        group(
          [
            { name: "1 Shot", price: 38 },
            { name: "6 Shots", price: 180 },
          ],
          "La Machina Flavoured Tequila",
          "Coffee | Watermelon | Pineapple & Coconut | Grapefruit",
        ),
      ],
    }),
    section({
      id: "whisky",
      title: "Whisky",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group(
          [
            gb("Ardbeg 10Yo", 85, 2290),
            gb("Benriach 12Yo", 67, 1790),
            gb("Glenfiddich 12Yo", 78, 1990),
            gb("Glenfiddich 15Yo", 125, 3250),
            gb("Glenfiddich 18Yo", 175, 4690),
            gb("Glenmorangie 12Yo The Original", 78, 1990),
            gb("Glenmorangie 15Yo The Lasanta", 120, 3190),
            gb("Glenmorangie 18Yo The Infinita", 195, 4990),
            gb("Lagavulin 16Yo", 170, 4290),
            gb("Talisker 10Yo", 98, 2650),
            gb("The Glenlivet Founders Reserve", 65, 1750),
            gb("The Glenlivet 12Yo", 78, 1990),
            gb("The Glenlivet 15Yo", 130, 3390),
            gb("The Macallan 12Yo Triple Cask", 140, 3490),
            gb("The Macallan 15Yo Double Cask", 240, 6250),
            gb("The Singleton 12Yo", 75, 1990),
            gb("The Singleton 15Yo", 120, 3190),
          ],
          "Single Malt",
        ),
        group([gb("Bains", 39, 990)], "Single Grain"),
        group(
          [gb("Buffalo Trace Bourbon", 47, 1290), gb("Bulleit Bourbon", 62, 1690), gb("Jack Daniel's Gentleman Jack", 50, 1390), gb("Woodford Reserve Bourbon", 60, 1650)],
          "American",
        ),
        group([gb("Jameson 18Yo", 180, 4850), gb("Jameson Select Reserve", 65, 1790), gb("Jameson Triple Triple", 55, 1490), gb("Roe & Co", 60, 1650)], "Irish"),
        group(
          [
            gb("Chivas Regal 12Yo", 50, 1390),
            gb("Chivas Regal XV 15Yo", 75, 1890),
            gb("Grant's 12Yo Triple Wood", 50, 1390),
            gb("Johnnie Walker Double Black", 65, 1750),
            gb("Johnnie Walker Gold Reserve", 80, 2190),
            gb("Johnnie Walker Green Label", 99, 2690),
            gb("Johnnie Walker 18Yo", 160, 3900),
            gb("Johnnie Walker Blue Label", 320, 8200),
            gb("Monkey Shoulder", 60, 1590),
          ],
          "Blended Scotch",
        ),
      ],
    }),
    section({
      id: "cognac",
      title: "Cognac",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([
          gb("Courvoisier V.S.", 70, 1790),
          gb("Courvoisier V.S.O.P", 110, 2990),
          gb("D'ussé V.S.O.P", 110, 2990),
          gb("Hennessy V.S", 70, 1790),
          gb("Hennessy V.S.O.P Privilege", 110, 2990),
          gb("Hennessy X.O", 300, 7500),
          gb("Martell Blue Swift", 115, 3090),
          gb("Martell V.S", 65, 1690),
          gb("Rémy Martin V.S Supérieur", 70, 1790),
          gb("Rémy Martin V.S.O.P", 110, 2990),
          gb("Rémy Martin 1738", 150, 3990),
          gb("Rémy Martin X.O", 320, 7900),
        ]),
      ],
    }),
    section({
      id: "gin",
      title: "Gin",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([
          gb("Bombay Sapphire", 42, 1150),
          gb("Hendrick's", 59, 1590),
          gb("Inverroche", 58, 1550),
          gb("Malfy", 50, 1390),
          gb("Tanqueray London Dry", 40, 1100),
          gb("Tanqueray Nº TEN", 59, 1590),
        ]),
      ],
    }),
    section({
      id: "vodka",
      title: "Vodka",
      priceLabels: GLASS_BOTTLE,
      note: "Add 6 Red Bull Energy Drinks to any bottle - 225",
      groups: [
        group([gb("Absolut", 39, 1050), gb("Belvedere", 65, 1790), gb("Cîroc", 65, 1790), gb("Cruz", 39, 1050), gb("Grey Goose", 68, 1890), gb("Skyy", 39, 1050)]),
      ],
    }),
    section({
      id: "tequila",
      title: "Tequila",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([
          gb("1800 Reposado", 85, 2290),
          gb("Altos Reposado", 50, 1390),
          gb("Casamigos Reposado", 95, 2590),
          gb("Código Reposado", 110, 3000),
          gb("Don Julio Reposado", 110, 3000),
          gb("Don Julio Anejo", 140, 3900),
          // Printed with a bottle price only; the glass column is blank on the original.
          gb("Don Julio 1942", undefined, 11000),
          gb("El Jimador Reposado", 45, 1290),
          gb("Espolón Reposado", 65, 1690),
          gb("Jose Cuervo Tradicional Reposado", 48, 1350),
          gb("Patròn Reposado", 110, 3000),
          gb("Teremana Reposado", 90, 2450),
          gb("Volcan Reposado", 95, 2590),
        ]),
        group([gb("Jägermeister", 40, 1090)], "Ice Cold Shots"),
      ],
    }),
    section({
      id: "red-wine",
      title: "Red Wine",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group(
          [
            gb("Anthonij Rupert Optima", undefined, 560),
            gb("Boschendal Nicolas", undefined, 490),
            gb("Douglas Green Merlot Malbec", 62, 179),
            gb("Fat Bastard Golden Reserve", undefined, 380),
            gb("Kanonkop Kadette", 125, 360),
            gb("Rupert & Rothschild Classique", undefined, 520),
            gb("Vilafonté Seriously Old Dirt", undefined, 560),
          ],
          "Blends",
        ),
        group([gb("Nederberg", 85, 250), gb("Warwick First Lady", undefined, 340)], "Cabernet Sauvignon"),
        group([gb("Durbanville Hills", 85, 250), gb("Spier Signature", undefined, 270), gb("Thelema", undefined, 520)], "Merlot"),
        group([gb("Beyerskloof", 95, 270)], "Pinotage"),
      ],
    }),
    section({
      id: "rose-wine",
      title: "Rosé Wine",
      priceLabels: GLASS_BOTTLE,
      groups: [group([gb("Douglas Green Sunkissed", 64, 185), gb("Fat Bastard", undefined, 290), gb("Haute Cabriere Pinot Noir", 90, 260), gb("Pink Valley", 110, 320)])],
    }),
    section({
      id: "white-wine",
      title: "White Wine",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([gb("Boschendal Chardonnay Pinot Noir", 98, 290), gb("Douglas Green Chenin Blanc Sauvignon Blanc", 62, 179)], "Blends"),
        group([gb("Boschendal 1685", undefined, 350), gb("Fat Bastard", 110, 320)], "Chardonnay"),
        group([gb("Franschhoek Cellar", 82, 240), gb("Kleine Zalze", undefined, 240)], "Chenin Blanc"),
        group([gb("Diemersdal", undefined, 270), gb("Durbanville Hills", 85, 250), gb("Spier Signature", undefined, 250)], "Sauvignon Blanc"),
        group([gb("Douglas Green Sunkissed Natural Sweet", 64, 185)], "Semi Sweet"),
      ],
    }),
    section({
      id: "champagne",
      title: "Champagne",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([
          gb("G.H. Mumm Grand Cordon Brut", undefined, 1690),
          gb("G.H. Mumm Ice Xtra Demi-Sec", undefined, 1850),
          gb("Moët & Chandon Brut Impérial", undefined, 1650),
          gb("Moët & Chandon Nectar Impérial", undefined, 1950),
          gb("Moët & Chandon Nectar Impérial Rosé", undefined, 2050),
          gb("Veuve Clicquot Yellow Label Brut", undefined, 1950),
          gb("Veuve Clicquot Rich", undefined, 2390),
        ]),
      ],
    }),
    section({
      id: "bubbles",
      title: "Bubbles",
      priceLabels: GLASS_BOTTLE,
      groups: [
        group([
          gb("Luc Belaire Luxe", undefined, 1190, { description: "France" }),
          gb("Luc Belaire Rosé", undefined, 1190, { description: "France" }),
          gb("Martini Prosecco", 110, 580, { description: "Italy" }),
          gb("Boschendal Brut", undefined, 490),
          gb("Boschendal Luxe Nectar", 99, 490),
          gb("Krone Brut", undefined, 490),
          gb("Krone Night Nectar", undefined, 490),
          gb("Pongrácz Brut", undefined, 480),
          gb("Pongrácz Noble Nectar", undefined, 480),
          gb("Pongrácz Rosé", undefined, 480),
          gb("Durbanville Hills Sparkling Rosé", undefined, 295),
          gb("Durbanville Hills Sparkling Sauvignon Blanc", undefined, 295),
        ]),
      ],
    }),
  ],
};

// ── FUNCTIONS ────────────────────────────────────────────────────────────────────────────────────────────────────
const functions: MenuBook = {
  id: "functions",
  label: "Functions",
  tagline: "Bring the team together for a celebration like no other.",
  sections: [],
};

const sharedStarters = [
  { name: "Korean Fried Cauliflower", vegetarian: true, description: "Tossed in sweet chilli soy, with spicy mayo" },
  { name: "Peri-Peri Chicken Livers", description: "With toasted ciabatta" },
  { name: "White Wine Mussels", description: "With garlic, dill & parmesan, toasted ciabatta" },
];

export const setMenus: SetMenu[] = [
  {
    id: "set-menu-one",
    title: "Set Menu One",
    price: 450,
    includes: "Your choice of starter, main & dessert",
    courses: [
      { title: "Starters", items: sharedStarters },
      {
        title: "Mains",
        items: [
          { name: "Peri-Peri Chicken Thighs", description: "Peri-peri basted, de-boned chicken thighs with your choice of side" },
          { name: "Queen Prawns", description: "8 Grilled lemon butter basted prawns, with your choice of side" },
          { name: "Greek Lamb Chops", description: "3 Seasoned loin chops with parmesan mash & zesty broccoli stems" },
          { name: "300g Rump", description: "BBQ basted, with your choice of side" },
          { name: "Zucchini & Mushroom Pasta", vegetarian: true, description: "Piquante peppers, chopped rocket, olive oil, garlic & lemon zest with linguine" },
        ],
      },
      {
        title: "Desserts",
        items: [
          { name: "Baked Cheesecake", description: "With meringue, strawberries & strawberry coulis" },
          { name: "Biscoff Malva Pudding", description: "With a Biscoff & Kahlua Coffee liqueur sauce & Biscoff crumble" },
          { name: "Pistachio Mousse", description: "With crispy kataifi & whipped cream" },
        ],
      },
    ],
  },
  {
    id: "set-menu-two",
    title: "Set Menu Two",
    price: 290,
    includes: "Your choice of starter & main",
    courses: [
      { title: "Starters", items: sharedStarters },
      {
        title: "Mains",
        items: [
          { name: "Cheese & Bacon Burger", description: "BBQ basted beef patty, bacon, cheddar cheese, red onion, lettuce & tomato, with your choice of side" },
          { name: "200g Sirloin", description: "BBQ basted, with your choice of side" },
          { name: "Zucchini & Mushroom Pasta", vegetarian: true, description: "Piquante peppers, chopped rocket, olive oil, garlic & lemon zest with linguine" },
          { name: "Peri-Peri Chicken Thighs", description: "Peri-peri basted, de-boned chicken thighs with your choice of side" },
          { name: "Hake & Chips", description: "Grilled OR fried with jalapeno mayo & your choice of side" },
        ],
      },
    ],
  },
];

// ── PROMOTIONS ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Rush Hour, from the last page of the cocktail menu. */
export const rushHour = {
  title: "Rush Hour",
  label: "Selected cocktails",
  days: "Daily",
  hours: "2pm to 6pm",
  price: 69,
  cocktails: ["Coco Mambo", "Watermelon Sugar", "Faithful Bitch", "Mojito", "Classic Margarita", "Long Island Ice Tea", "Strawberry Daiquiri"],
} as const;

/** Potential promo, deliberately NOT part of the official cocktail menu until its ingredients and price are confirmed. */
export const orchidMist = {
  name: "Orchid Mist",
  partner: "Glenfiddich",
  blurb: "Whether you choose a classic double or the Orchid Mist cocktail, experience Glenfiddich at News Cafe.",
  status: "Ingredients and price awaiting confirmation",
} as const;

export const menuBooks: MenuBook[] = [breakfast, food, cocktails, functions];
