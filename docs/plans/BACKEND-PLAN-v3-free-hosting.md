# News Cafe — Backend Plan v3: R0 Hosting Budget

**Status: PLAN ONLY.** No accounts created, nothing deployed, no databases created, no code changed, nothing pushed or bought.
This replaces the hosting section of v1/v2 (the all-Azure R710/month plan is withdrawn because it is not R0).
Research date: 2 Nov 2026, from the providers' own documentation. Where a page was silent I say **"not stated"**; I have not filled gaps with assumptions.

## Honest bottom line
- A **genuinely free development/testing environment (Plan A) is achievable** with no card and no charges possible.
- A **R0 production setup (Plan B) is technically achievable, but it is a "soft-launch grade" setup, not a "reliable restaurant system" grade one.** The main reasons: (1) no South African database region exists on any free provider I checked (nearest: Frankfurt/London); (2) free plans carry no uptime guarantee or support; (3) I could not find an explicit written permission for **commercial production use** on Neon's or Cloudflare's free plans (the documents are silent; Neon calls Free "prototypes, side projects"); (4) built-in database restore is only **6 hours** on the free database, so backups must be self-built; (5) hitting a daily/monthly cap switches a feature **off** (reservations unavailable) until the quota resets; (6) Next.js 16 on Cloudflare's free CPU limit is unproven and must be tested first.
- It can be made safe for a restaurant by a **fail-safe design**: the public website (menu, photos, contact details) runs as free static files that stay up even if the database or API is down, and booking falls back to "request a booking / call us" whenever the backend is unavailable.
- If you cannot accept points (3) and (5), then **reliable production hosting cannot be achieved for R0**, and the cheapest honest alternative is the paid plan from v2 (about R710/month). I am not asking for that now.

---------------------------------------------------------------------------------------------------------------------

## 1. Ownership and control (applies to both plans)
| Item | Rule |
|---|---|
| Root email | One business-controlled mailbox/alias (for example one on newscafe.co.za) is the sign-up email for **every** account. Never a developer's address. |
| Owners | **Two owner-level people** on every platform (you plus a trusted second person) so one lost phone cannot lock the business out. |
| GitHub | A GitHub **organization** owned by the business; developers are members/outside collaborators with the lowest role needed. Org owners = you + second owner. |
| Cloudflare, database host, email provider | Accounts created by **you** (I never create accounts); developers are invited as members and can be removed in one click. |
| 2FA | Required on all accounts; recovery codes printed and kept by you (a safe), never emailed to developers. |
| Domain / DNS | Registered in the business's name; registrar login held by you. |
| Secrets | In each platform's secret store and a password manager owned by the business; never in GitHub; I never see them. |
| Handover | An **Ownership Register** (every account, plan, owner email, where recovery codes are, renewal dates), a runbook and an **offboarding checklist**: remove member, rotate database password and API keys, revoke sessions, confirm backups still run. |
| Data | Database, uploads and encrypted backups live in accounts you own; a monthly export is also saved to storage you own. |

---------------------------------------------------------------------------------------------------------------------

## 2. Provider verification (official documentation, 2 Nov 2026)
Legend: ✔ verified in official docs · ? not stated in what I could read · ✘ disqualifying.

| Provider / product | 1 Commercial use | 2 Free limits | 3 DB storage / compute | 4 Region | 5 Backup & recovery | 6 Inactivity | 7 When limits exceeded | 8 Payment details | 9 Surprise charges |
|---|---|---|---|---|---|---|---|---|---|
| **Vercel Hobby** | ✘ "personal, non-commercial use" | — | — | — | — | — | — | — | **Excluded** |
| **Cloudflare Workers + static assets** | ? No commercial ban in general terms; free services have "no liability"; **may not collect card details on a free-plan site** (so no deposits) | 100,000 requests/day; 10 ms CPU per request; 50 subrequests; static-asset requests **free and unlimited** | — | Global network incl. **Johannesburg, Cape Town, Durban** | Code lives in GitHub | None | Daily cap: error 1027 / 429 (billing not mentioned for Free) | ? Not stated for Free (R2 below differs) | None found for Free; paid plan is $5/month minimum and must be chosen |
| **Cloudflare D1** (SQLite, not PostgreSQL) | ? as above | 5M reads/day, 100k writes/day; 500 MB per database, 5 GB per account | SQLite | Not verified | **7-day Time Travel on Free** | None | Queries fail until reset; no billing on Free | ? | None found for Free |
| **Cloudflare Hyperdrive** | ? | 100,000 queries/day on Free | connection pooling to external Postgres | — | — | — | Excess queries fail | ? | None found |
| **Cloudflare R2** (files) | ? | 10 GB, 1M/10M operations | — | — | — | — | Over free tier is **billed** ($0.015/GB…) | Sources say a payment method is commonly **required before a bucket can be created** (not confirmed in official page) | **Billing can occur → excluded** |
| **Neon (PostgreSQL) Free** | ? Terms silent; docs describe Free as "prototypes, side projects, small teams", Scale as "production-grade" | 100 CU-hours/month per project, 5 GB egress | **1 GB storage per project** (20 GB total); autoscale up to 2 CU; 10 branches | **Frankfurt, London**, US, Singapore, Sydney, São Paulo; **no Africa** | **6-hour** restore window; 1 manual snapshot; no instant restore | Compute **scales to zero after 5 min** (cold start); project and data are not paused or deleted | Compute **suspended until next month** (CU-hours/egress); writes **blocked** at 1 GB; "none of these limits delete data"; "Free plan usage isn't charged" | **No card required** | None stated; upgrade is manual |
| **Supabase Free** | ? ToS silent; third-party sources say commercial use is allowed | 500 MB database, 1 GB files, 5 GB egress, 2 projects | 500 MB | No African region | **No automatic backups** | **Paused after 1 week of inactivity** | Service restrictions (read-only/402/pause); no charges described for Free | ? Not stated | None stated; but pausing makes it **unsuitable for production** |
| **Render Free** | ✘ "Do not use them for production applications" | 750 h/month; sleeps after 15 min; ~1 min cold start | Free Postgres **expires after 30 days**, 1 GB, **no backups** | — | None | Sleeps / expires | Suspends if no payment method | Not required | **Excluded** |
| **Netlify Free** | ? not stated | "300 credits" (reset period not stated) | — | — | — | — | not stated | ? | **Not verifiable → not recommended** |
| **GitHub Free (org)** | ✔ private repos allowed | **$12/month of Actions compute** (≈2,000 min), 500 MB artifacts | — | — | Git history | — | **Blocked (not billed) when no payment method is on file** | Not required | Cannot be charged if no card is added |
| **Resend Free (email)** | ? not addressed | **100 emails/day, 3,000/month** | — | — | — | — | Sending stops | ? | None found |
| **Brevo Free (email)** | ? not addressed | **300 emails/day** | — | — | — | — | Sending stops | ? | None found |
| **Backblaze B2 (files/backups)** | ? | First 10 GB free | — | — | — | — | Over 10 GB is billed | Not stated | **Billing can occur → card status unclear** |
| **Oracle / Azure / AWS / Google free tiers** | — | Require a card; trials expire or convert; Oracle Always Free in Johannesburg has reported capacity shortages and idle-instance reclamation | — | Johannesburg / SA North exist | — | — | Can convert to paid | **Card required** | **Excluded by your rules** |

**Not verified (so not relied on):** whether Cloudflare Free needs a card (sign-up), Neon/Supabase/Cloudflare written commercial-use permission, Neon cold-start time and how many of the 100 CU-hours a quiet restaurant site would use, Cloudflare D1 location options, Brevo/Resend payment requirements.

---------------------------------------------------------------------------------------------------------------------

## 3. Plan A: free development and testing environment (safe to approve first)
| Piece | Choice | Why it is safe |
|---|---|---|
| Source control | GitHub organization, private repo | Free; Actions **blocked, not billed**, if no card is added |
| Database | **Local PostgreSQL in Docker** on the developer's machine (+ optional Neon Free project with fake data) | Docker is free; Neon needs no card and does not charge |
| App | Local Next.js dev server; optional Cloudflare Workers free preview URL | Free-plan daily caps simply stop requests |
| Email | Local mail catcher (no real sending) | Zero cost, zero risk |
| Data | **Fake data only**, never customer data | No privacy risk |
| CI | GitHub Actions within the $12 included allowance | Free; stops if exceeded |
| Staging | A second Neon branch + Cloudflare preview deployment, same free limits | No card, no billing |
Rules: no card ever entered; no resource created without your written approval; one account per service (no multiple-account tricks to dodge limits, which Cloudflare's terms forbid).

---------------------------------------------------------------------------------------------------------------------

## 4. Plan B: R0 production design, with limitations
**Architecture (changed from v1 to fit free limits and stay portable):**
- **Public site:** the existing Next.js site prerendered to **static files**, served from Cloudflare's free static-asset hosting (unlimited requests, close to guests in Johannesburg/Cape Town/Durban). It stays online even if the database or API fails.
- **API + admin:** a small, standard **TypeScript API** (Hono or similar) on a free Cloudflare Worker; admin dashboard as a client-side app calling it. This avoids running full server-side React inside the 10 ms free CPU limit and avoids depending on Cloudflare's *beta* Next.js adapter (vinext; Cloudflare's docs mark it beta). A 2–3 day proof-of-concept in Plan A must confirm the limits before commitment.
- **Database:** **Neon Free PostgreSQL** (Frankfurt or London), because the approved double-booking protection (PostgreSQL exclusion constraint) needs real PostgreSQL. Alternative: Cloudflare D1 (SQLite) keeps everything in one account with 7-day Time Travel, but needs a different no-overlap design (a unique key per table per 15-minute slot) and makes later migration to PostgreSQL harder.
- **Photos:** resized in the browser before upload and stored as small images **inside PostgreSQL**, served with long cache headers. 100 photos at ≤ 200 KB ≈ 20 MB of the 1 GB. (R2 and B2 are excluded because they can bill or want a card.)
- **Email:** Brevo Free (300/day) preferred over Resend Free (100/day): each booking sends two emails (guest + owner), so Resend caps around 50 bookings/day. When the daily limit is hit, emails queue for the next day and the dashboard still shows every booking.
- **Backups (self-built, free):** nightly GitHub Actions job runs `pg_dump`, **encrypts** it (`age`, private key held offline by you), and stores it in a **second private repository owned by the business**; a monthly copy also goes to storage you own. Neon's own 6-hour restore is the only quick undo. Recovery drill: restore the latest dump into a fresh local/Neon database and run the double-booking tests (same drill as v2, free).
- **Portability:** standard PostgreSQL + ordinary TypeScript API + Drizzle migrations. Moving to paid hosting later means: new database, restore dump, change a connection string, redeploy. No Cloudflare- or Neon-only features in application code.
- **Fail-safe design:** health check on the booking widget; if the API/database is down, over quota or suspended, the page shows "Request a booking: call or email us" and the contact details, and nothing breaks.
- **No card payments or deposits** on R0 (Cloudflare's free terms forbid collecting card details on a free-plan site).

### Limitations and risks of Plan B (for a real reservation system)
| # | Risk | Effect | Mitigation |
|---|---|---|---|
| 1 | No SA database region (Frankfurt/London) | Slower booking queries; personal data stored outside South Africa (POPIA cross-border rules; take legal advice) | Cache availability; keep personal data minimal; privacy notice |
| 2 | Commercial use not explicitly permitted in free-plan docs | Provider could restrict an account | **Ask Neon and Cloudflare for written confirmation before launch**; keep migration path ready |
| 3 | No uptime guarantee or support | Outage with no recourse | Static site stays up; phone fallback |
| 4 | Neon cold starts after 5 minutes idle | First booking request after a quiet period is slower | Static pages unaffected; show "checking availability" |
| 5 | Neon 100 CU-hours/month cap | If exceeded, database suspended until next month, **reservations offline** | Monitor usage; cache reads; fail-safe fallback; pre-agreed upgrade trigger (not automatic) |
| 6 | Neon 1 GB cap, writes blocked when full | New bookings fail | Purge old data per retention policy; alert at 70% |
| 7 | Cloudflare 100,000 requests/day, 10 ms CPU | Bot traffic or heavy pages could trip limits | Turnstile, caching, small API; static pages don't count |
| 8 | Only 6-hour built-in restore | A mistake discovered next day cannot be undone by the provider | Nightly encrypted dump; audit log; soft-delete in app |
| 9 | Email caps (300/day Brevo) | Confirmation emails delayed on very busy days | Dashboard is the source of truth |
| 10 | Free terms may change | Limits shrink or products change | Quarterly review; portable design |
| 11 | Free plan accounts can be suspended for ToS reasons | Downtime | Two-owner accounts; documented migration |
| 12 | Next.js-on-Workers compatibility unproven | Rework | Static + separate API design; proof-of-concept first |
Overall rating for a real restaurant: **acceptable for a soft launch where the owner confirms bookings manually (auto-confirm stays OFF) and a phone fallback exists; not suitable for guaranteed 24/7 automatic confirmation.**

---------------------------------------------------------------------------------------------------------------------

## 5. Effect on cost, schedule and earlier decisions
- Monthly cost: **R0** for Plan A and Plan B as designed; one-off cost: none. A paid upgrade would only happen if **you** choose it.
- Schedule: roughly the same 45–60 working days, plus about 3–5 days for the proof-of-concept, image-in-database handling and backup automation (estimate).
- Everything in v2 about reservations, tables, durations, admin features and tests still applies, except card deposits (not possible on R0) and the Azure sections.

## 6. Decisions I need from you (nothing starts until you approve)
1. Approve Plan A (development/testing) now? (Docker + GitHub org + optional free Neon dev project; no card.)
2. For Plan B: do you accept the limitations in section 4, in particular launching with manual confirmation and a phone fallback, and storing data in a European region?
3. Will you ask Neon and Cloudflare (or let me draft the emails) to confirm in writing that free-plan commercial production use is permitted?
4. Who is the second owner for every account, and which business email will be the root login?
5. All open reservation questions from v1 (hours, tables, durations, rules, alert emails).
