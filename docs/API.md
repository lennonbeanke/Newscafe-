# API design (DRAFT, not implemented)

Status: **design only.** No API server exists yet (milestone A2, needs the owner's approval). The machine-readable draft is [openapi.draft.yaml](openapi.draft.yaml).

## Principles
* Small TypeScript API, standard HTTP/JSON, portable between hosts (no provider-specific code in business logic).
* All booking logic is the database function `book_reservation()`; the API only validates input (schemas), rate-limits, calls it and maps error codes.
* Public endpoints never reveal other guests' data. Admin endpoints require an owner session and check authorization **on the server** for every call.
* Every public form is protected by Turnstile + rate limits; inputs are validated; sizes are capped.
* **Failure behaviour:** if the database is unavailable, over quota or suspended, booking endpoints answer `503` with `fallback: "request"`. The website then offers an *email request*, never a confirmation (see [FREE-TIER-LIMITS.md](FREE-TIER-LIMITS.md)).

## Public endpoints (draft)
| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | Is the booking service usable? | Used by the site to switch to "request a booking" mode |
| `GET /api/availability?date&party` | Open slots and alternatives | Empty / `not_configured` until the owner finishes setup |
| `POST /api/reservations` | Booking request | Idempotency key header; `201` pending/confirmed, `409` no table (with alternatives), `422` rule violation, `503` fallback |
| `POST /api/contact` | Contact enquiry | Stored; owner notified |
| `POST /api/function-enquiries` | Function / event enquiry | Stored; owner notified |
| `GET /api/menu`, `/api/promotions`, `/api/gallery`, `/api/settings` | Website content (cached) | Read-only |

## Admin endpoints (draft, owner session required)
Reservations (list, confirm, edit, move, cancel, complete, no-show, history) · tables and combinations · reservation rules and durations · opening/special hours · menu items and prices · promotions · gallery upload · function enquiries · contact messages · site settings · audit log (read-only). `POST /api/admin/login` (rate-limited, lockout), `POST /api/admin/logout`. **There is no registration endpoint.**

## Error mapping
`NC001`→`503 not_configured` · `NC002`→`409 no_availability` · `NC004/NC005/NC006/NC007`→`422` · `NC008`→`422 consent_required` · `23P01`→`409` · database unreachable / quota → `503 fallback=request`.
