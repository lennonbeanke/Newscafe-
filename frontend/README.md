# Nocturne — luxury lounge marketing site

A cinematic, animation-led marketing website for a restaurant, cocktail bar and live-music venue.
Marketing only: no accounts, dashboards or backend.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion · GSAP + ScrollTrigger · Lenis · React Icons

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Pages

`/` Home · `/menu` · `/events` · `/gallery` · `/about` · `/contact`

## Make it yours

| What | Where |
| --- | --- |
| Brand name, address, phone, email, hours, socials, site URL | `lib/site.ts` |
| Menu, events, gallery items, timeline, press quotes | `lib/data.ts` |
| Photography (currently Unsplash placeholders) | `lib/images.ts` — swap for local files in `public/images` |
| Hero background video | drop `public/videos/hero.mp4` (see the README beside it) |
| Colours / fonts / glass + gold utilities | `styles/globals.css` |
| Production URL for SEO (canonical, sitemap, OG) | env `NEXT_PUBLIC_SITE_URL` |

All names, contact details and the map location are **placeholders**.

## Structure

```
app/          routes, metadata, sitemap, robots, icon, 404
components/
  layout/     Navbar, Footer, PageHero
  providers/  SmoothScroll (Lenis↔GSAP), TransitionProvider (curtain), Preloader
  sections/   home/ menu/ events/ gallery/ about/ contact/
  ui/         Button, SplitReveal, Reveal, ParallaxImage, Marquee, Lightbox, Cursor, ScrubText…
hooks/  lib/  styles/  types/  public/
```

## Motion system

- **Lenis** drives scroll; it is clocked by GSAP's ticker so ScrollTrigger and Lenis never drift.
- **GSAP ScrollTrigger:** pinned word-by-word manifesto, zoom-to-fullscreen reveal, horizontal events track
  (with counter-parallax via `containerAnimation`), parallax images, drifting gallery columns, self-drawing timeline.
- **Framer Motion:** preloader, curtain page transitions, masked headline reveals, staggered cards,
  shared-layout lightbox, animated tabs/filters, magnetic buttons, custom cursor.
- Every GSAP effect lives in `gsap.context()` / `matchMedia()` and is reverted on unmount.
  `prefers-reduced-motion` disables scroll-scrubbed effects and smooth scrolling.

## SEO

Per-page `metadata`, canonical URLs, Open Graph/Twitter cards, `sitemap.xml`, `robots.txt`,
and JSON-LD (`Restaurant`, `Menu`, `Event`).

## Notes

- The contact form has no backend: it opens a pre-filled email to the address in `lib/site.ts`.
  Wire it to a form service if you want server-side submissions.
- The map is an OpenStreetMap embed recoloured with a CSS filter to match the dark theme.
