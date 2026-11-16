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

## Owner dashboard (`/admin`)

The owner area is a private tool inside the same Next.js app: sign-in with e-mail address and password only (no authenticator, by the owner's decision), then the dashboard. It talks to the backend **only over HTTP** (`/api/admin/*`, forwarded in development by `next.config.ts` to the owner API on `127.0.0.1:8788`) and holds no secrets, environment files or backend code. Open it as `http://localhost:3000/admin` (not `127.0.0.1`).

| Command | What it does |
|---|---|
| `npm run dev` | Development server on `http://localhost:3000` |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | Unit and static security tests (Node 24, no extra packages) |
| `npm run test:ui` | Dashboard overview in headless Edge with committed FAKE API answers (`tests/fixtures/`); needs only the dev server |
| `npm run test:ui:reservations` | Reservation list, booking page, status changes, edit and move in headless Edge against a stateful FAKE API |
| `npm run test:ui:login` | Sign-in screen and session handling in headless Edge against a FAKE API |
| `npm run test:ui:shell` | Owner shell: Light/Dark colour sets, charcoal sidebar, responsive layout, keyboard, contrast (headless Edge, FAKE API) |

**Look and theme.** The owner area has its own Light and Dark colour sets (`styles/globals.css`, `html[data-admin-theme]`), applied only while `/admin` is open; the public site keeps its own. Light is the default and follows the approved design; the visible Light | Dark switch is in the top bar. The choice is remembered in the browser under one key, `nc-owner-theme`, holding only the word `light` or `dark` (nothing else from the owner area is ever stored; `lib/owner-theme.ts` is the one module allowed to touch storage, and a test pins that down). A tiny inline script in `app/admin/layout.tsx` applies it before first paint, so there is no flash. The logo (`public/admin/news-cafe-logo.svg`) and coffee-cup picture (`public/admin/coffee-cup-placeholder.svg`) are placeholders: replace those files with the real artwork, keeping the names.

Code: `app/admin/`, `components/admin/`, `lib/admin/`. Tests: `tests/unit/`, `tests/ui/`, `tests/fixtures/`. Tests that need the backend as well are in the repository's `e2e/` folder.
