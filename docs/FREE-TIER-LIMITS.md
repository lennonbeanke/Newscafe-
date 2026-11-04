# Free-tier outages and limitations (for the R0 production option, Plan B)

Researched 2 Nov 2026 from provider documentation. Details and sources: [plans/BACKEND-PLAN-v3-free-hosting.md](plans/BACKEND-PLAN-v3-free-hosting.md). Plan B is **not approved or created**; this page explains what to expect.

## What can go wrong, and what customers see
| Event | Cause | Effect | What the website does |
|---|---|---|---|
| Database asleep | Neon scales to zero after 5 minutes idle | First booking request is slower | "Checking availability…" |
| Database suspended | Monthly compute-hours (100) or egress used up | Database offline until next month | **Request mode** (below) |
| Database full | 1 GB storage reached; writes blocked | New bookings/enquiries fail | **Request mode**; owner is alerted; old data is anonymised/purged per policy |
| API over daily limit | 100,000 requests/day on the free Worker | Dynamic requests fail until midnight UTC | Static pages keep working; **Request mode** |
| Email daily cap reached | e.g. 300 emails/day (Brevo) | Confirmation emails delayed | Dashboard remains the source of truth |
| Provider outage / account restriction | No SLA or support on free plans; terms can change | Booking unavailable | Static site stays up; phone fallback |
| Quick-restore window | Neon Free restores only the last 6 hours | Older mistakes need our own backup | Nightly encrypted dump |
No limit deletes data (per Neon's documentation), and nothing is charged because no card is on file.

## Booking failure fallback (hard rule)
**If the database cannot be reached, the system never confirms a booking.**
1. Normal: booking saved in the database; the guest sees a confirmation only after the save succeeded.
2. Database or API unavailable: the form switches to **"Request a booking"**. The request is sent by email straight to the owner's inbox (no database involved). The guest is told "request received, we will confirm by email or phone". It is never marked confirmed.
3. Everything down: the static page shows phone, WhatsApp and email.
4. When service returns, the owner enters email requests into the dashboard.
This fallback is designed here and built and tested in milestone A2 (including a test with the local database stopped).

## Reliability rating
Suitable for a soft launch with manual confirmation and a phone fallback. **Not** suitable for guaranteed 24/7 automatic confirmation. If outages lose bookings, or usage stays above 70% of a cap for two weeks, or a provider refuses commercial use, the owner decides whether to move to paid hosting (the design is portable; nothing upgrades automatically).
