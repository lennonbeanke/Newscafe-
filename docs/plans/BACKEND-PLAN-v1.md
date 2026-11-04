# News Cafe — Backend & Admin Dashboard: Plan for Review

**Status: PLAN ONLY.** Nothing in this document has been built, run, deployed or applied to any database.
SQL and code below are illustrative sketches for review, not executed.
Prices were read from the providers' pricing pages on 2 Nov 2026 and converted at an *assumed* R17 per US$ (the most recent
reliable rate I could find was about R16.5, dated late July 2026; please check a live rate). All prices exclude VAT.

---------------------------------------------------------------------------------------------------------------------

## 1. What already exists in the project

| Area | Finding |
|---|---|
| Frontend | Next.js 16.4.2, React 19.3, TypeScript, Tailwind 4, Framer Motion, GSAP, Lenis. Six pages, all **statically prerendered**. |
| Backend / API | **None.** No route handlers, server actions, middleware or server code. |
| Database / ORM | **None.** No database library, no connection config. |
| Authentication | **None.** |
| File storage | Menu/gallery photos are static files in `public/` (`/menu`, `/videos`) and stock images from Unsplash. |
| Content | Lives in code: `lib/menu-data.ts` (4 menus, 311 priced entries), `lib/data.ts` (promos, gallery, timeline), `lib/site.ts` (name, address, phone, email, social). |
| Forms | The contact form only builds a `mailto:` link; nothing is stored or sent by the site. |
| Hosting / deployment | **None configured**: no `vercel.json`, Dockerfile, pipeline, `.github`, Azure or Railway files. Only local dev servers have been run. |
| Environment files / secrets | **No `.env` files exist** (contents were never read). `.env*` is git-ignored. |
| Source control | The project folder is **not its own git repository**. It sits inside an unrelated repository at your home folder, with no remote configured for it. No GitHub or Azure DevOps connection exists for News Cafe yet. |

**Consequence:** nothing needs reusing or replacing; a backend must be built from scratch. The existing data files are a
ready-made seed source (menu, promos, gallery, settings).

---------------------------------------------------------------------------------------------------------------------

## 2. Recommended architecture

**One codebase, one deployment:** extend the existing Next.js app (no separate backend service to run or pay for).

```
Visitors ──► Next.js (Vercel)  ──► Route Handlers / Server Actions ──► PostgreSQL (Supabase, Cape Town region)
                │                         │                                   │
   static + cached public pages           ├─ validation (zod), rate limits     ├─ row-level security: deny-all for public
   (revalidated when owner edits)         ├─ email (transactional provider)    └─ daily backups + our own nightly dump
                                          └─ file storage (Supabase Storage: photos)
Owner ──► /admin (server-rendered, session-protected, 2FA) ──► same server layer (server-side authorization on every action)
```

| Concern | Recommendation | Why |
|---|---|---|
| Database | **PostgreSQL** | Needed for the reservation guarantees below (range types + exclusion constraints) |
| ORM / migrations | **Drizzle ORM + drizzle-kit** (Prisma is an acceptable alternative) | SQL-first, lightweight, works with Next 16. Both need hand-written SQL for the exclusion constraint; Drizzle makes that natural |
| Validation | **zod** schemas shared by forms, API and docs | One definition per input |
| Auth | **Own minimal owner auth** (details in section 6); Supabase Auth with sign-ups disabled is the alternative | Single owner, no social login, vendor-portable |
| Storage | **Supabase Storage** (bundled) with server-side upload checks and image resizing | No extra vendor |
| Email | Transactional provider (Resend / Postmark / SES) with SPF + DKIM on newscafe.co.za | Guest confirmations and owner alerts |
| Bot protection | Cloudflare Turnstile (free) on public forms | Stops spam bookings |
| Caching | Public pages stay static/ISR; owner edits trigger `revalidateTag` | Keeps the fast, cinematic front end |
| API docs | OpenAPI 3.1 generated from the zod schemas; served only in dev/staging or behind owner login | Docs can't drift from code |

Multi-branch note: News Cafe is a franchise brand (Stores / Franchising on the current site). The schema includes a
`locations` table from day one (cheap now, painful to retrofit); the first release can run a single location.

---------------------------------------------------------------------------------------------------------------------

## 3. Proposed database tables & relationships

Conventions: UUID primary keys, `created_at/updated_at`, money as integer cents, all timestamps `timestamptz` (UTC) displayed in `Africa/Johannesburg`.

**Core / settings**
- `locations` (id, name, address fields, phone, email, timezone)
- `site_settings` (location_id?, name, tagline, description, social links jsonb, legal text, age notice, hero media)
- `opening_hours` (location_id, weekday, opens_at, closes_at, closes_next_day bool, sort) — several rows per weekday allowed (split shifts / past-midnight)
- `special_hours` (location_id, date, is_closed, opens_at, closes_at, label) — public holidays, private events, closures

**Menu** (mirrors today's `menu-data.ts` structure exactly)
- `menu_books` (breakfast / food / cocktails / functions) → `menu_sections` (title, subtitle, note, price_labels e.g. Glass|Bottle, sort)
  → `menu_groups` (title, note, sort) → `menu_items` (name, description, note, is_vegetarian, is_marked [the "N" badge], alcohol_free_price, is_active, sort)
- `menu_item_prices` (item_id, label, amount_cents) — single price, Glass/Bottle, Glass/Carafe
- `menu_item_addons` (item_id, label, amount_cents) and `menu_item_tradeups` (item_id, name, price_cents)
- `menu_flag_settings` (enabled, label) — owner switches the "N" badge on once its meaning is confirmed
- `menu_price_history` (item_id, old, new, changed_by, changed_at)

**Promotions, functions, events**
- `promotions` (slug, kind, title, blurb, price_cents, days_of_week, starts_at_time, ends_at_time, valid_from/to, **status: active | awaiting_confirmation**, is_published, media_id)
  - Rush Hour = promotion (R69, 14:00–18:00, daily) linked via `promotion_items` to its 7 menu items
  - Orchid Mist = promotion with status `awaiting_confirmation`; ingredients/price nullable until you confirm
- `function_packages` (title, price_cents, includes, is_published) → `package_courses` → `package_course_items` (Set Menu One / Two)
- `function_enquiries` (name, company, email, phone, event_date, guests, package_id, message, **status: new | contacted | quoted | confirmed | declined | closed**, owner_notes)
- `events` (title, kind, blurb, starts_at, ends_at, recurrence, is_published, media_id)

**Customer messages & gallery**
- `contact_messages` (name, surname, phone, email, type [Complaint | Compliment | Suggestion | General], message, status [new | read | replied | archived])
- `media_assets` (storage_path, mime, bytes, width, height, alt_text, uploaded_by) and `gallery_items` (media_id, category, ratio, sort, is_published)

**Reservations & tables** (section 4)
- `dining_tables`, `table_combinations`(+members), `reservation_settings`, `duration_rules`, `reservations`, `table_allocations`, `reservation_events`

**Admin & security**
- `admin_users` (email unique, password_hash [Argon2id], role, totp_secret_encrypted, failed_logins, locked_until)
- `admin_sessions` (token hash, user_id, expires_at, revoked_at, ip hash, user agent)
- `login_attempts` (key hash, attempted_at, success) — rate limiting
- `audit_logs` (actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip hash, at) — append-only (UPDATE/DELETE revoked)
- `idempotency_keys` (key, request hash, response) — safe retries on booking

Key relationships: book → sections → groups → items → prices/add-ons; promotion ↔ menu_items; package → courses → items;
reservation ↔ table_allocations ↔ dining_tables (many-to-many so a party can take combined tables); every owner action → audit_logs.

---------------------------------------------------------------------------------------------------------------------

## 4. Reservation logic for 40+ tables

### Tables
`dining_tables(id, location_id, label, section, min_covers, max_covers, is_active, online_bookable, notes)`.
Owner can add, edit, disable (temporarily or permanently) and reorder tables in the dashboard. `table_combinations`
lets the owner define which tables may be joined for large parties and the combined capacity. **No capacities are
assumed**; the table list starts empty and must be entered by you.

### The guarantee: the database refuses double bookings
Every held slot is a row in `table_allocations` with a time range. A PostgreSQL **exclusion constraint** makes overlap
on the same table *impossible*, regardless of application bugs or simultaneous requests:

```sql
-- ILLUSTRATIVE ONLY (not applied anywhere)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE table_allocations (
  id uuid PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES dining_tables(id),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reservation','block','function')),
  during tstzrange NOT NULL,
  active boolean NOT NULL DEFAULT true,
  EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)
);
```
Cancelled / no-show reservations set `active = false`, freeing the table instantly. Maintenance blocks and function
take-overs use the same table, so they can never collide with a reservation either.

### Availability search (read path)
1. Find the opening period(s) for the date (`special_hours` override `opening_hours`).
2. Resolve the duration **D** from `duration_rules` for this party size / day / time (section 5). If nothing is configured, online availability is disabled and the form falls back to "request a booking".
3. Generate start times every `slot_interval` minutes inside opening hours, honouring minimum notice, maximum advance days and last-seating offset.
4. For each start time, one query returns active, online-bookable tables with enough capacity (and not wastefully oversized) that have **no overlapping allocation** for `[start, start + D + turnaround buffer)`.
5. Pick the best-fit table (smallest adequate capacity; then section preference; then least fragmentation); parties above the largest table use an owner-defined combination.

### Booking (write path, one transaction)
```
BEGIN
  re-run the availability query for the chosen start
    SELECT ... FROM dining_tables ... FOR UPDATE SKIP LOCKED   -- concurrent requests are steered to different tables
  INSERT reservation
  INSERT table_allocations      -- the exclusion constraint is the final safety net (error 23P01 → try next table or return alternatives)
COMMIT
```
Extra protections: idempotency key (double-click/retry safe), optional advisory lock per date+service if a "max covers per slot" cap is used, and a hold expiry for Pending requests.

### Alternatives when the time is unavailable
Return the nearest open start times the same day (before and after, up to a configurable count), then the same time on
neighbouring days, then the option to join a waiting list / send a request to the owner.

### Statuses & history
`pending → confirmed → completed`, plus `cancelled` and `no_show`. Every change writes a `reservation_events` row (who, when,
old → new status, changed fields). Owner can confirm, edit, move table/time (re-checked against the constraint) or cancel.

### When a booking is auto-confirmed
Only when **all** are true: auto-confirm is switched on by the owner; the setup checklist is complete (opening hours,
duration rules, slot interval, tables entered); a genuinely free suitable table exists; the booking is inside the rules
(party size, notice, window). Otherwise it is saved as **Pending** with a provisional table hold and the owner is notified.
**Auto-confirm ships switched OFF** until you confirm the items in section 8.

### Performance
Tens of tables and a few hundred bookings a day are tiny for PostgreSQL. A GiST index on `(table_id, during)` backs both
the constraint and the availability query.

---------------------------------------------------------------------------------------------------------------------

## 5. Configurable reservation duration (nothing assumed)

Managed in the dashboard under **Reservation rules**, stored in the database, no code changes:

- `reservation_settings` (per location): `slot_interval_minutes`, `turnaround_buffer_minutes`, `min_party_size`, `max_online_party_size`,
  `min_notice_minutes`, `max_advance_days`, `last_seating_before_close_minutes`, `late_grace_minutes`, `pending_hold_minutes`,
  `auto_confirm_enabled` (default **false**). **Every value starts empty (NULL)**: the system reports "not configured" rather than guessing.
- `duration_rules`: rows such as *default*, *party size 1–2*, *party size 7+*, *Fri–Sat evening*, each with `duration_minutes` and a priority.
  The most specific matching rule wins; if none matches and there is no default, online booking is disabled.
- The booking stores its own `starts_at`, `ends_at` and a duration snapshot, so **changing a rule affects new bookings only**; existing bookings are untouched.
- Owner can override the duration on a single reservation, or run an explicit "apply new duration to future bookings" with a preview of any conflicts it would create.
- A **readiness checklist** on the dashboard shows exactly what is still missing before online booking / auto-confirm can be switched on.

---------------------------------------------------------------------------------------------------------------------

## 6. Owner-only authentication & security

**Authentication**
- No public registration page or endpoint exists. Owner accounts are created once by a developer-run script after you approve, never through the website.
- Passwords hashed with **Argon2id**; minimum length and breached-password check; optional but recommended **TOTP two-factor** (authenticator app) with one-time recovery codes.
- Server-side sessions: random token in an `HttpOnly; Secure; SameSite=Lax` cookie, only a **hash** of the token stored in the database; idle and absolute timeouts; "sign out everywhere".
- **Login rate limiting and lockout**: per IP + per email, exponential back-off, temporary lock after repeated failures, generic error messages.
- Authorization is checked **on the server inside every admin action and route**, not only by hiding menu items; `/admin` is also gated by the proxy/middleware layer.

**Application security**
- Input validation on every public and admin input (zod); output encoding; parameterised queries via the ORM.
- Public forms: Turnstile, per-IP and per-email rate limits, honeypot, request size limits.
- Uploads: type/size allow-list, re-encode with a library, strip EXIF/GPS, random file names, no executable content.
- Strict security headers (CSP, HSTS, frame, referrer, permissions), CSRF protection (SameSite + origin checks).
- Database: row-level security **deny-all** for public/anon roles; the app uses a least-privilege role; audit table is append-only.
- Secrets only in each environment's secret store; never in the repo, logs or client bundles; separate keys per environment.
- POPIA (South Africa): privacy notice and consent on forms, minimal personal data, retention period for old reservations/enquiries, deletion/export process.
- Audit log of important owner actions (price changes, table changes, rule changes, reservation status changes, logins, uploads/deletions).

---------------------------------------------------------------------------------------------------------------------

## 7. Hosting recommendation

**No existing hosting, database or file storage was found**, so these are all new choices. Nothing has been selected or purchased.
Prices below were read on 2 Nov 2026; confirm before buying.

| Option | What it is | Verified pricing (USD) | Approx. ZAR / month at R17 | Notes |
|---|---|---|---|---|
| **A. Vercel Pro + Supabase Pro (recommended)** | App on Vercel, Postgres + file storage on Supabase | Vercel Pro $20/seat; Supabase Pro from $25 | **≈ R765** (R340 + R425) | Best fit for this Next.js app. Supabase Pro: 8 GB DB, 100 GB file storage, 250 GB egress, daily backups kept 7 days, never paused. Vercel Pro: 1 TB transfer, commercial use allowed. Cape Town region for the database and a Cape Town function region should be selectable (confirm at setup) |
| B. Railway (app + Postgres together) | One platform for everything | Hobby $5 + usage: about $20 per vCPU-month, $10 per GB RAM-month, $0.15 per GB disk-month, $0.05 per GB egress | **≈ R340–R600** (rough estimate from the rates) | Cheapest. The pricing page does not state whether Postgres backups are included, so backups would be self-managed. No South African region confirmed (higher latency from SA) |
| C. Azure (given the Azure DevOps mention) | App Service / Static Web Apps + Azure Database for PostgreSQL, South Africa North | **Not priced here** | to be quoted | Same architecture works; worth pricing in Azure's calculator if you prefer the Microsoft ecosystem or already use Azure DevOps pipelines |
| D. Vercel Hobby / Supabase Free | Free tiers | $0 | R0 | **Not suitable**: Vercel Hobby forbids commercial use; Supabase Free has no backups and pauses after a week of inactivity |

**Estimated extras (not all verified):** transactional email ≈ R0–R350 (check the chosen provider); independent nightly backup
storage < R50; Turnstile free; domain you already own. Optional Supabase **point-in-time recovery $100/month ≈ R1,700**, only if
you need minute-level restore; daily backups plus our own nightly dump are the suggested starting point. Compute upgrade
if ever needed: Supabase Small is $15 vs $10 for Micro (small difference).

**Recommendation:** Option A, about **R765/month (≈ R9,200/year)** ex-VAT, with the database in the Cape Town region.
Reasons: first-class Next.js hosting, managed Postgres with backups, built-in photo storage, one bill, and the lowest
operational burden for a restaurant team. Decision and purchase wait for your approval.

**Data recovery & maintenance:** provider daily backups (7 days) + our own encrypted nightly `pg_dump` to separate storage
(30 days) + a documented restore drill (quarterly) + dependency updates and a monthly security/backup check.
Target: lose at most 24 hours of data (RPO), restore within a few hours (RTO).

---------------------------------------------------------------------------------------------------------------------

## 8. Environments, process, phases, risks, questions

### Environments & safety
| | Development | Staging | Production |
|---|---|---|---|
| Database | Local disposable Postgres (Docker or Supabase CLI) | Separate Supabase project, fake seeded data | Separate project |
| Hosting | Local | Vercel preview/staging domain | newscafe.co.za |
| Secrets | Local only, git-ignored | Staging store | Production store |
| Migrations | Created and reviewed in git | Applied first | **Only after your explicit approval**, preceded by a backup |

- **Nothing in planning (or development) touches the production database.** No production migration, deployment, data change or purchase happens without your explicit approval.
- Forward-only reviewed migrations with a rollback plan, and a backup before every production migration.
- CI runs lint, type-check, unit, integration and end-to-end tests on every change (GitHub Actions or Azure Pipelines, your choice).
- **Required automated tests:** reservation conflict and double-booking tests, including a concurrency test that fires many simultaneous bookings at the last free table and asserts exactly one succeeds; back-to-back boundary tests; past-midnight opening hours; duration-rule changes; and tests that no data is exposed to non-owners.

### Phases (rough effort in working days for one developer; estimates only)
| # | Phase | Delivers | Est. |
|---|---|---|---|
| 1 | Inspection | This report; repo and environment set-up (dedicated git repository, staging project) | 1–2 |
| 2 | Database design + owner authentication | Schema, migrations, seed scripts, login, 2FA, rate limiting, audit log | 4–6 |
| 3 | Menu database + Admin | Menu tables seeded from the verified menu data; CRUD for categories/items/prices; price history; "N" badge switch | 5–7 |
| 4 | Reservation + table management | Tables, hours, rules, availability engine, booking transaction, owner reservation screens, emails | 10–14 |
| 5 | Functions + enquiries | Packages, function enquiry flow, contact inbox, notifications | 4–5 |
| 6 | Gallery, promotions, settings | Photo upload/management, Rush Hour / Orchid Mist promotions, site settings, hours | 5–6 |
| 7 | Frontend ↔ backend integration | Public pages read from the database (cached), booking widget, forms, revalidation | 5–7 |
| 8 | Security, testing, deployment prep | Pen-test checklist, load/concurrency tests, backups and restore drill, docs, go-live runbook | 5–7 |
| | **Total** | | **≈ 39–54 days** |

### Main risks
1. **Unconfirmed reservation rules** (duration, buffers, party limits): auto-confirm can't be enabled safely until these are supplied.
2. **Table data**: capacities, sections and combinable tables must be accurate or availability will be wrong.
3. **Walk-in vs booking balance**: a restaurant that also takes walk-ins may not want every table bookable online (handled by `online_bookable`, but needs your policy).
4. **Multi-branch scope**: a franchise brand; confirm whether this is one venue now.
5. **Email deliverability**: needs SPF/DKIM on the domain, otherwise confirmations land in spam.
6. **Owner account security**: one compromised owner login exposes everything; hence 2FA and audit logs.
7. **Cost drift** on usage-priced plans (Vercel/Railway); mitigated by caching and spend alerts.
8. **POPIA compliance** for guest personal data.
9. **Vendor lock-in**: kept low by using standard Postgres and our own auth.
10. **Source control**: the project currently isn't in its own repository; fix before collaboration.

### Outstanding questions for the owner
**Reservations**
1. Opening hours for every day (including late nights past midnight, split shifts, public holidays, and any closure dates).
2. Table list: how many exactly (>40), each table's minimum/maximum capacity, section (indoor/outdoor/bar…), which tables can be joined, and which are walk-in only.
3. Reservation duration policy: one length for everyone, or by party size / day / time? Turnaround time between bookings? Late-arrival grace period?
4. Booking rules: slot interval (15/30 min?), minimum notice, how far ahead, largest online party, last seating before closing.
5. Should large parties go to the Functions enquiry flow instead of online booking? Above what size?
6. Is a deposit or card guarantee needed? (That would add a payment provider.)
7. No-show and cancellation policy and what should be sent to guests (email only, or also SMS/WhatsApp reminders)?
8. Who receives new booking alerts, at which email addresses?

**Scope & ownership**
9. Is this one restaurant now, or several branches? Should Stores / Franchising / franchisee login be part of this backend?
10. Who are the owner login(s)? Authenticator-app 2FA acceptable? What recovery process do you want if the owner loses access?
11. Do you control the domain newscafe.co.za and its DNS (needed for email and go-live)? What is it hosted on today?
12. GitHub or Azure DevOps for source control and CI (nothing is configured yet)?
13. Budget ceiling and any hosting preference (for example Azure).
14. Menu governance: who edits prices, and do you want scheduled price changes? Should Rush Hour times and price be editable? Confirm the "N" badge meaning when known.
15. Function packages: deposit, minimum guests, or a quote workflow?
16. Privacy: do you have a POPIA privacy policy and data-retention period for reservations and enquiries?

**Nothing is built or changed until you review this plan and approve the phases.**
