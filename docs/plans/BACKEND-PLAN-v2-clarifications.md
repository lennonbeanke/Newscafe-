# News Cafe — Backend Plan v2: Answers to Review Questions

**Status: PLAN ONLY.** No code written, nothing migrated, deployed, pushed, merged or purchased.
Research date: 2 Nov 2026. Prices exclude VAT (SA VAT of 15% may apply on invoices). ZAR figures use an **assumed R17 per US$**
(latest rate I could find was ≈ R16.5, dated late July 2026; I could not get today's rate. Please check a live rate).

## CORRECTION to plan v1
Plan v1 said the database could sit in a Cape Town region on Supabase "to be confirmed at setup". **That was wrong.**
Supabase's official regions page lists 17 AWS regions (US, Canada, Europe, Asia-Pacific, São Paulo) and **none in Africa**.
A community request for Cape Town has been open since 2024 with no official answer or date. Vercel **does** have Cape Town.
The architecture itself (standard PostgreSQL, Drizzle, own owner auth, no Supabase-specific features) is unaffected, so only the host changes.

---------------------------------------------------------------------------------------------------------------------

## 1. GitHub: private repository for frontend + backend

**Layout (one repository, one history):**
```
newscafe/
  frontend/        Next.js app (public site + /admin + server code/API) 
  docs/            plans, runbooks, API docs
  scripts/         backup/restore/seed scripts (no secrets)
  .github/         CI workflows
  .gitignore  .gitleaks.toml  README.md
```
**Steps (nothing done yet):**
1. **You** create a GitHub *organization* owned by the restaurant (so ownership never depends on one developer), turn on 2FA for every member, and create an **empty private** repository (no README/licence) named e.g. `newscafe`.
2. I run `git init` **inside** `your home folder/Desktop/Newscafe`. Important: that folder currently sits inside an unrelated repository at your home folder (`your home folder`), which tracks things like `.claude`, `.config` and `.gemini`. A new repository inside `Newscafe` isolates the project, and I will never run `git add` from the home-folder repo.
3. **Before the first commit** I add `.gitignore` covering: `.env*` (but keep `.env.example` with empty placeholders), `node_modules`, `.next`, `.vercel`, `*.pem`, `*.key`, `*.p12`, `*.dump`, `*.sql` backups, `backups/`, `.DS_Store`, scratch/test output.
4. **Secret checks before anything leaves your machine:** `git ls-files` review for env/key/dump files, a full **gitleaks** scan of the working tree and history, and a review of the file list with you. A gitleaks pre-commit hook and a CI job keep this on for every later change.
5. Connect: `git remote add origin …` using SSH or the GitHub CLI. **You sign in yourself; I never see or handle passwords, tokens or keys.**
6. First push **only after you explicitly approve** the file list. Protected `main`, work on branches, pull requests, CI must pass before merge.
7. Real secrets live **only** in the host's secret store (Azure / Vercel) and, for CI, GitHub Actions secrets. Separate values for dev, staging and production.

**Plan limits to know (GitHub docs):** Free allows unlimited private repositories, but protected branches and built-in secret scanning/push protection for private repos are **not** listed on Free (they come with paid plans; I did not verify the current price). The gitleaks hook/CI job covers secrets on Free; decide whether branch protection is worth a paid Team seat. Azure DevOps Repos is an equivalent alternative if you prefer it.

**Open decision:** include the four original menu PDFs in the repo, or keep them outside? (Default: keep out; they are not needed to run the site.)

---------------------------------------------------------------------------------------------------------------------

## 2. Hosting: verified regions, pricing and ZAR costs

### What I verified
| Provider | South African region? | Evidence |
|---|---|---|
| **Vercel** | **Yes, Cape Town `cpt1` (af-south-1)**, a compute-capable region (19 regions in total). Functions default to Washington D.C. (`iad1`), so the region must be set explicitly. | Vercel regions docs (updated 11 Aug 2026) |
| **Supabase** | **No.** No African region on its official list. | Supabase regions docs; open community request since 2024 |
| **Azure PostgreSQL Flexible Server** | **Yes, `South Africa North`** has published prices, so the service is offered. Whether *your* subscription can create it there (quota/capacity) must be confirmed in the portal. | Azure retail prices API |
| **Azure App Service (Linux)** | **Yes, South Africa North** has published prices. | Azure retail prices API |

### Current prices (USD, exact)
- **Vercel Pro:** $20 per developer seat/month incl. $20 usage credit; 1 TB Fast Data Transfer included. Hobby is non-commercial only. Cape Town `cpt1` usage rates are Pro-only: Fast Data Transfer $0.28/GB, Active CPU $0.20/h, Fast Origin Transfer $0.43/GB (higher than the base region; a small restaurant site is unlikely to approach these volumes).
- **Vercel Static IPs** (needed to firewall a database to Vercel): **$100/month per project**, plus transfer.
- **Supabase Pro:** from $25/month (8 GB DB, 100 GB files, 250 GB egress, daily backups kept 7 days, PITR add-on ≈ $100/month). Free: no backups, pauses after 1 week idle.
- **Azure PostgreSQL Flexible, South Africa North:** Burstable B1ms $0.0215/h (≈ $15.70/month), B2s $0.086/h (≈ $62.80/month); storage $0.151/GB/month (32 GB ≈ $4.83); backups free up to 100% of provisioned storage, then $0.113/GB/month.
- **Azure App Service Linux, South Africa North:** B1 $0.0243/h (≈ $17.74/month), B2 $0.0487/h (≈ $35.55/month), P0v3 $0.0965/h (≈ $70.45/month).
- **Azure Blob (hot, LRS), South Africa North:** $0.0219/GB/month (a few GB of photos costs cents).

### The important finding: Vercel + Azure database has a firewall problem
Vercel functions use dynamic IP addresses. An Azure database firewall can only allow fixed IPs, so you must either leave the database open to the internet (relying on TLS + strong credentials only; weaker) or buy **Vercel Static IPs at $100/month**. That makes "Vercel + Azure database" the most expensive and least tidy combination.

### Options and monthly cost (R17 per US$, ex-VAT)
| Option | Where things run | Production ≈ per month |
|---|---|---|
| **1. All-Azure, South Africa North (recommended)** | App Service B1 + PostgreSQL B1ms (32 GB) + Blob storage; optional free Cloudflare in front for CDN/DDoS | App R302 + DB R349 + photos ≈ R10 + off-site backups ≈ R50 (unverified estimate) = **≈ R710**; + email R0–R350 (unverified) = **R710–R1,060** |
| 2. Vercel Pro + Supabase Pro (Europe region) | App in Cape Town/EU, database in Europe | R340 + R425 = **≈ R765** (+ email). Database data stored outside South Africa (POPIA cross-border rules apply; take legal advice), higher query latency from SA (not measured), but the simplest to operate; staging on Supabase Free (R0) |
| 3. Vercel Pro (cpt1) + Azure database + Static IPs | | R340 + R349 + R1,700 ≈ **≈ R2,400**: not recommended |
| 4. Wait for a Supabase Cape Town region | | No date exists; not a plan |

**Staging:** needed in every option. All-Azure: a stopped database costs storage only (≈ R82/month); an always-on staging app + DB adds ≈ R650/month. Realistic all-in with on-demand staging: **≈ R800–R1,100/month**; always-on staging: ≈ R1,350–R1,700.

### Recommendation (no purchase until you approve)
**Option 1, all-Azure in South Africa North**: data and application stay in South Africa (best latency to your guests, simplest POPIA story), private database access without the Vercel Static-IP problem, built-in encrypted backups with PITR, lowest cost, and fits your Azure DevOps mention. Trade-offs I'm being straight about:
- I haven't verified that your Azure subscription can create these resources in South Africa North (some regions need a quota request). Check first.
- More hands-on setup than Vercel: CI/CD pipeline, no automatic preview deployments (a staging app replaces them).
- App Service has no worldwide CDN by itself; add free Cloudflare in front for static assets and video (not yet verified for your DNS setup).
If you prefer the least operational work and accept an EU database, Option 2 is the fallback.

---------------------------------------------------------------------------------------------------------------------

## 3. Backups and recovery (Azure PostgreSQL Flexible Server)

**Layer 1: automatic provider backups (Azure docs, updated July 2026)**
- Daily snapshot plus continuous transaction-log archiving. **Retention: 7 days default, up to 35**: we set **35**.
- **Point-in-time recovery to any moment** in the window; RPO up to ~5 minutes. AES-256 encryption at rest, always on.
- A restore **creates a new server** (never overwrites the original), then the app is repointed or just the lost rows are copied back.
- Backup files cannot be exported, and **deleting the server deletes its backups**, so a delete-lock is applied to the server.
- Burstable servers cannot take on-demand snapshots; we use `pg_dump` for ad-hoc backups.
- Backup storage is free up to the provisioned storage size, beyond that $0.113/GB/month.
- **Geo-redundant backup can only be chosen when the server is created.** I will check whether South Africa North supports it (not verified) before creation.

**Layer 2: our own encrypted, off-site copy (protects against account/region loss, accidental server deletion and provider problems)**
1. Nightly job runs `pg_dump -Fc` (plus roles/globals) of the production database and syncs the photo container.
2. The dump is **encrypted on our side** with `age` (public key; the private key is held offline by you and the developer, never in GitHub, CI or the server).
3. Uploaded to a **separate provider/account** (for example Backblaze B2 or AWS S3, with versioning/object-lock so a hacked server cannot delete history). Retention: 30 daily + 12 monthly.
4. The job alerts the owner by email on failure or if the newest backup is older than 26 hours.
5. Optional extra: Azure Backup long-term retention (weekly/monthly, up to 10 years, separate security domain).

**Restoration playbooks (written and rehearsed)**
- *Mistaken edit or deletion:* PITR to a new server at the chosen time, verify, then copy rows back or switch over.
- *Server or account lost:* create a new server, decrypt the latest off-site dump with the offline key, `pg_restore`, restore photos, repoint the app, smoke-test.
- *Targets:* data loss ≤ ~5 minutes (PITR) and ≤ 24 hours (off-site dump); service back within ~1–4 hours.

**Recovery test (before launch, then every quarter), always on a throwaway server, never production:**
1. Insert marker data in staging; note the time. 2. PITR to 10 minutes earlier: confirm marker data is absent and everything earlier is present.
3. Decrypt and restore the latest off-site dump to a fresh server using only the offline key and the runbook. 4. Compare row counts and checksums; confirm migrations table and the **exclusion constraint** exist.
5. Run the double-booking test suite against the restored database. 6. Record the timings and delete the test server. 7. The owner signs off the checklist.

---------------------------------------------------------------------------------------------------------------------

## 4. Reservation features: confirmed
| Requirement | Supported? | How |
|---|---|---|
| **More than 40 tables** | **Yes**, no fixed upper limit | Every table is a database row; I will load-test with 100+ synthetic tables |
| **Table combinations** | **Yes** | Owner defines which tables can join and the combined capacity; a booking blocks every member table in one transaction |
| **Walk-in-only tables** | **Yes** | `online_bookable = false` hides a table from online booking; staff can still seat or block it manually |
| **Different party sizes** | **Yes** | Per-table min/max covers; global and per-day limits; large parties routed to the Functions flow above an owner-set size |
| **Configurable durations** | **Yes** | Rules by party size / day / time, set in the dashboard, no code; nothing assumed; bookings keep their own stored duration |
| **No double booking** | **Yes** | Database exclusion constraint + transaction/locking + concurrency tests |
All values (capacities, hours, durations, rules) start **empty** and must be entered or confirmed by you; auto-confirm stays off until the readiness checklist is complete.

---------------------------------------------------------------------------------------------------------------------

## 5. Admin Dashboard: no code editing needed for content
**You can manage without a developer:** menu books, sections, categories, items, descriptions, prices (with price history), vegetarian/alcohol-free flags, trade-ups and add-ons, the "N" badge switch; promotions (Rush Hour price, days, hours, cocktail list; Orchid Mist details and publish switch); gallery photos (upload, reorder, categories, alt text, hide/delete); opening hours, special/holiday hours and closures; address, phone, email and social links; reservations (view, confirm, edit, move table/time, cancel, complete, no-show, history); tables and combinations; reservation rules and durations; function packages and function enquiries; contact messages.
**Still needs a developer:** new page types, layout/design/animation changes, new features, and changes to how a menu section is visually presented. Adding a new category or item within the existing design is no-code.

---------------------------------------------------------------------------------------------------------------------

## 6. Improving mobile Lighthouse (72–73) without changing the design
**Measured from the saved reports (production build, mobile throttling), not guessed:**
| Page | Score | Main problem |
|---|---|---|
| Home | 72 | **Total Blocking Time 1,540 ms** (JavaScript execution: 2.5 s boot time, 7.6 s main-thread work under 4× CPU throttling). Page weight is small (847 KiB), LCP 1.4 s, CLS 0 |
| Menu | 73 | **LCP 3.9 s** and TBT 630 ms. Page weight 558 KiB |
So the problem is **JavaScript main-thread work, not network or hosting**. A faster host will not lift the score; code changes will.
**Plan (each step measured, with before/after screenshot comparison so the design is visually identical):**
1. Identify the heaviest chunks with the bundle analyzer; load animation libraries (GSAP/ScrollTrigger, Lenis, Framer's full feature set) only on screens that use them or after first interaction; use Framer's lighter `domAnimation` where `domMax` isn't needed.
2. Skip smooth-scroll and heavy effects on touch devices (native scrolling is smoother and cheaper; desktop effects unchanged).
3. Menu LCP: make the first visible element a small, preloaded image/heading with `fetchpriority`, and defer below-the-fold sections and photos.
4. Hero video on mobile: poster first, video only on good connections (no data-saver), smaller mobile encodes.
5. Fonts subset/preload; map embed behind a click-to-load facade.
6. Add a Lighthouse CI budget so the score can't regress.
**Realistic expectation:** 85–95 is plausible; I won't promise 90 until measured, and Lighthouse scores vary by about ±5 between runs. Any step that would visibly change the design is skipped and reported to you first.

---------------------------------------------------------------------------------------------------------------------

## 7. Testing plan before launch
| Area | What is tested | Pass condition |
|---|---|---|
| **Reservation conflicts** | Back-to-back boundaries; overlapping requests on same table; 50–200 simultaneous requests for the last free table; combined tables; walk-in-only exclusion; past-midnight hours; duration-rule change affects only new bookings; cancel/no-show frees table; status history; alternatives; idempotent retries | Exactly one winner; zero overlaps in the database; zero 5xx |
| **Security** | Login rate limiting/lockout; no public registration endpoint; every admin route and action returns 401/403 when anonymous; session expiry/revocation; CSRF; input validation/SQL injection/XSS; upload abuse; security headers; dependency audit; secret scan of repo and bundles; deny-all database access for the public; OWASP ZAP scan of staging; log review for leaked data | No high/critical findings open |
| **Mobile and responsive** | Existing suite (5 widths × all pages × both themes) plus admin screens and booking flow on real iPhone/Android and emulators; keyboard and screen-reader pass; axe | No overflow; zero axe violations; touch targets ≥ 44 px |
| **Performance** | Lighthouse mobile/desktop on staging; load test on booking API | Agreed budgets met |
| **Database recovery** | Section 3 drill | Restore verified; times recorded |
| **Functional and regression** | Unit tests for rules/availability engine; API integration tests; end-to-end tests of admin tasks and guest booking; menu prices in the database equal the 311 verified prices; emails delivered | All green in CI |
| **Migrations** | Applied to a copy of staging data first; rollback rehearsed | Zero data loss |
| **User acceptance** | You test the dashboard with real tasks | Written sign-off |
Production is **never** used for testing.

---------------------------------------------------------------------------------------------------------------------

## 8. Phases and estimated effort (working days, one developer; estimates only)
| # | Phase | Features completed | Days |
|---|---|---|---|
| 1 | Foundations | Your decisions (hosting, GitHub); GitHub org + private repo, secret-safe `.gitignore`, CI skeleton; dev/staging environments; Azure setup (after approval); project structure | 3–4 |
| 2 | Database + owner auth | Schema + migrations + seed from verified menu/site data; owner login (Argon2id), optional 2FA, sessions, rate limiting, audit log, no public sign-up; first backup + restore drill | 5–7 |
| 3 | Menu + Admin shell | Dashboard layout; categories/items/prices/flags CRUD, price history; public menu page reads from database; verified against the 311 prices | 5–7 |
| 4 | Reservations + tables | Tables, combinations, walk-in-only; opening hours and special hours; rules and configurable durations; availability engine; booking transaction with exclusion constraint; alternatives; statuses and history; owner reservation screens; email notifications; conflict/concurrency tests | 11–15 |
| 5 | Functions + enquiries | Function packages, enquiry form and inbox, contact-form inbox, status workflow, notifications | 4–5 |
| 6 | Gallery, promotions, settings | Photo upload/resize/reorder; Rush Hour and Orchid Mist promotions; site settings (address, contact, social) | 5–6 |
| 7 | Frontend ↔ backend integration + performance | Public pages and booking widget on live data (cached/revalidated); forms; mobile performance work from section 6 | 6–8 |
| 8 | Hardening + launch prep | Full test plan (section 7), security scan, automated encrypted off-site backups, recovery test, monitoring/alerts, documentation, go-live runbook | 6–8 |
| | **Total** | | **45–60** |
The earlier 39–54 estimate rose by about 6 days because: Azure/own-infrastructure setup (more than one-click hosting), the backup automation and recovery tests, and the mobile performance work are now explicit. These are estimates, not quotes, and dependent on you answering the open reservation questions early.

---------------------------------------------------------------------------------------------------------------------

## Decisions I need from you before implementation
1. **Hosting:** Option 1 (all-Azure, South Africa North), Option 2 (Vercel + Supabase Europe), or something else? And do you already have an Azure subscription (and who owns it)?
2. **GitHub:** create the organization and private repo; include the PDFs or not?
3. **Exchange rate/budget:** confirm the monthly budget ceiling.
4. Still open from v1: opening hours, table list and capacities, duration policy, booking rules, large-party threshold, deposits, alert email addresses, owner login details and 2FA preference, branch scope, POPIA policy.

**Nothing starts until you approve in writing.**
