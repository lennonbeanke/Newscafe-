# API (milestone A2, local development)

Status: **public endpoints, owner sign-in and the owner's reservation management are implemented and tested.** The Admin Dashboard screens (A4), contact/function enquiries, content endpoints and the request-mode outbox are later milestones.

The API runs as **two separate processes**, each with only its own database login and settings:

| Process | Address | Serves | Database login | Settings file |
|---|---|---|---|---|
| Public API (`src/server-public.ts`) | `127.0.0.1:8787` | health, availability, booking request | `newscafe_public` | `backend/.env.public` |
| Owner API (`src/server-admin.ts`) | `127.0.0.1:8788` | sign-in, reservation management, audit log | `newscafe_admin` | `backend/.env.admin` |

Machine-readable descriptions, generated from the same schemas the servers validate with (a test fails if they are stale): [openapi.json](openapi.json) (public) and [openapi-admin.json](openapi-admin.json) (owner). [openapi.draft.yaml](openapi.draft.yaml) holds the *draft* of the later content endpoints.

Local only: the API listens on `127.0.0.1:8787` (fixed, never another address), talks only to the local development database, and refuses to start in any other configuration (see "Startup safety guards").

## Principles
* Small TypeScript API (Node 24, Hono, Zod, `pg`). All booking rules live in the database; the API validates input, rate-limits, calls the two `public_*` database functions and maps the answer.
* The public database login (`newscafe_public`) can do nothing except call `public_available_slots` and `public_book_reservation`. A bug in the API therefore cannot read customer data (see [DATABASE.md](DATABASE.md)).
* **A booking is never reported as saved unless the database committed it.** If the database cannot be reached, booking endpoints answer `503` with `fallback: "request"` and the website offers "request a booking" instead.
* Errors never contain SQL, database messages, host names, stack traces or other guests' data. Every answer carries a `request_id` (also in the `X-Request-Id` header) that can be quoted to the developer.

## Endpoints
All paths are under `http://127.0.0.1:8787`. Requests and responses are JSON. Every response has `Cache-Control: no-store` and the security headers listed below.

### `GET /api/health`
Is online booking usable right now? Returns **only** `{"status":"ok","booking":"available"}` or `{"status":"ok","booking":"request_only"}`. Nothing else (no version, no database name, no timings).
* Answered from a cache (30 s while the database is up, 5 s while it is down). The database is touched only when someone calls this **and** the cached answer is old. There is no timer or background polling, so a free scale-to-zero database can sleep. **The website must not poll this endpoint on a timer.**
* HTTP 200 whenever the API itself is up, even when booking is `request_only`.

### `GET /api/availability?date=YYYY-MM-DD&party=N`
Bookable start times for a local date and party size. Only times are returned (never table names or counts).
`200 {"date":"2026-12-04","party":2,"slots":["2026-12-04T08:00:00.000Z", ...]}` (UTC instants; an empty list means nothing is bookable that day). Answers may be cached for up to 10 s; the booking itself re-checks everything.
Errors: `422 validation_failed` (bad/missing/extra parameters), `422 party_size_not_allowed`, `422 outside_booking_window` (date more than ~400 days away or in the past), `503 not_configured`, `503 booking_unavailable`, `429 rate_limited` (60 per minute per client).

### `POST /api/reservations`
Request a table. Headers: `Content-Type: application/json` and `Idempotency-Key` (16-128 letters, digits, `-`, `_`; make a fresh random one per booking form and **re-use it when retrying**).
```json
{ "party_size": 2, "starts_at": "2026-12-04T19:00:00+02:00", "name": "Jane Doe",
  "email": "jane@example.com", "phone": "+27 82 000 0000", "notes": "Window seat", "consent": true }
```
* `email` or `phone` is required (either alone is fine). `notes` is optional (max 500). `consent` must be `true`. **Unknown fields are rejected** (a client can never set status, source, test flag, consent time, ids or tables).
* `201 {"reference":"05E04210","status":"pending","party_size":2,"starts_at":"2026-12-04T17:00:00.000Z"}`. `status` is `pending` until the owner confirms, or `confirmed` only if the owner switched auto-confirm on. Sending the same key and the same request again returns the same booking (never a second one).
* `409 no_availability` (nearby `alternatives` listed when known) · `409 idempotency_conflict` (that key was used for a different request) · `413` (body over 16 KB) · `415` (not JSON) · `422 validation_failed` (`issues` lists *where*, never the values) · `422 not_on_slot | closed | outside_booking_window | party_size_not_allowed | consent_required | invalid_input` · `429` (10 per 10 minutes per client) · `503 not_configured | booking_unavailable | outcome_unknown` · `500 internal_error`.

## When the database or the API is unavailable (hard rules)
| Situation | Answer | What the website must do |
|---|---|---|
| Database unreachable, hung, restarting, over a limit | `503 booking_unavailable`, `fallback: "request"` (+ `contact` if configured). Nothing is saved. | Switch to "request a booking"; never show a confirmation |
| Booking rules not yet configured by the owner | `503 not_configured`, `fallback: "request"` | Same |
| Connection lost **after** the request reached the database | One automatic retry with the same key; if still unresolved: `503 outcome_unknown` (`retry_with_same_key: true`) | Say "we could not confirm"; retry with the **same** key or use request mode. Never "saved", never "failed for sure" |
| Database is not the development database (wrong label) | Treated as unreachable; no statement is sent | Same as unreachable |
| After a failure | The API fails fast for 3 s (no pile-up), then tries again | Nothing |
| API process itself down / network error | (no answer) | Treat any failed request as "not received": show phone / WhatsApp / e-mail. *Wiring this into the website is a later milestone.* |

## Startup safety guards (each process refuses to start, naming the setting but never its value, unless)
`APP_ENV=development`; `NODE_ENV` is not `production`; none of `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD` ... is set; the database host is `127.0.0.1`/`localhost`; the database is `newscafe_dev` or `newscafe_test*`; the login is exactly `newscafe_public` (public process) or `newscafe_admin` (owner process) with a 32+ character password, never an owner/superuser account; **the public process refuses to start if it can see any admin setting (admin login, either key, admin port) and the owner process refuses if it can see any public setting**; the owner process's two keys are 64 hex characters and differ; the allowed web origin is a local `http` origin; the public outbox folder is inside `api/`. If the database is down at start the API still starts and answers `request_only`; on the first connection it checks that the database labels itself `development` and refuses everything otherwise.

## Security behaviour
* Strict input validation (Zod): trimmed, length-capped text; control characters refused; unknown fields refused; dates must carry a UTC offset; body limit 16 KB; JSON only.
* Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-site`.
* CORS: only the configured local origin (`http://localhost:3000`); no credentials.
* Rate limits (in memory, keyed by a keyed hash of the connection address; `X-Forwarded-For` is never trusted): availability 60/min, bookings 10 per 10 min. A persistent limiter is a Plan B item.
* Logs are JSON with an allow-list of fields (request id, method, route *pattern*, status, duration, failure class). Names, e-mails, phones, notes, idempotency keys, passwords, keys, tokens, cookies, bodies and query strings are never written (and e-mail/phone shapes are masked as a second line of defence).
* Parameterised SQL only; connection errors are swallowed per connection so a dropped database connection cannot crash the process.
* Not yet built: contact/function enquiries, content endpoints, the request-mode outbox (next step), the Admin Dashboard screens (A4).

## Owner (admin) API: `http://127.0.0.1:8788`
Owner-only. There is **no registration endpoint**; the only account is created by a developer-run script (`backend/scripts/create-owner.sh`, fake `@example.invalid` address only in this milestone).

### Signing in (e-mail and password only)
**There is no second factor.** The owner decided to sign in with e-mail address and password alone (see [SECURITY.md](SECURITY.md) for what that means). The authenticator and recovery-code steps, and their five endpoints, were removed.
1. `POST /api/admin/login` `{email, password}` -> **200** `{signed_in: true, csrf_token, user, session_expires_at}` and the full session cookie, at once. Unknown e-mail, wrong password, deactivated, non-owner and locked accounts all answer the **same** `401 invalid_credentials`.
2. `GET /api/admin/me` (also returns the `csrf_token` to send) and `POST /api/admin/logout` (revokes on the server).
3. A half-finished session left over from the former two-step sign-in (`mfa_pending`) is **never** accepted as signed in; only logout can still see it, so it can be revoked.

| Rule | Value |
|---|---|
| Password hashing | Argon2id, 64 MiB, 3 passes, random salt; weaker stored hashes are upgraded at the next sign-in |
| New owner accounts | password of **at least 12 characters** (and at most 128, no control characters, not the e-mail address). Sign-in itself accepts any existing password |
| Session cookie | `nc_admin_session`: random 256-bit token, a fresh one at every sign-in, `HttpOnly; SameSite=Strict; Path=/api/admin` (`Secure` is switched on for production); only a SHA-256 hash is stored |
| Session life | 12 hours at most; ends after 30 minutes without a request; revoked on logout / deactivation / role change |
| Lockout | 5 consecutive wrong passwords lock the account for 15 minutes (a correct sign-in resets the count); 10 failures per e-mail+address in 15 minutes -> `429`; 30 sign-in attempts per address per 15 minutes -> `429` |

### CSRF (three layers, every state-changing request)
`Origin` must be exactly the dashboard origin (`http://localhost:3000` in development) · header `X-Requested-With: newscafe-admin` · header `X-CSRF-Token` = the value from sign-in / `/me` (bound to the session). Refusals are `403 csrf_origin | csrf_header | csrf_token`.

### Reservation management (signed-in owner only; guest data, never cached)
| Method and path | Purpose |
|---|---|
| `GET /api/admin/reservations` | list / search: `from`, `to` (local dates), `status`, `q` (name, e-mail, phone, reference), `include_test`, `limit` (<=100), `offset` |
| `GET /api/admin/reservations/{id}` | one reservation (viewing it is audited) |
| `GET /api/admin/reservations/{id}/history` | full append-only change history with who did each change |
| `POST /api/admin/reservations` | staff booking (phone / walk-in / admin); confirmed immediately; may use walk-in-only tables; optional `Idempotency-Key` |
| `POST .../{id}/confirm` | pending -> confirmed |
| `POST .../{id}/cancel` `{reason?}` | releases the table |
| `POST .../{id}/complete` · `.../no-show` | confirmed -> completed / no-show (no-show releases the table) |
| `POST .../{id}/reinstate` | cancelled / no-show -> back (re-checks the table; `409 table_taken` if it was given away) |
| `POST .../{id}/move` `{starts_at?, party_size?, duration_minutes?, table_id?}` | atomic: all or nothing |
| `PATCH .../{id}` `{guest_name?, guest_email?, guest_phone?, notes?}` | contact details and notes only |
| `GET /api/admin/audit-log` | who did what (newest first, `before=<id>` to page); never contains guest personal data |
| `GET /api/admin/readiness` · `GET /api/admin/tables` | read-only helpers for the dashboard |

**Every change** is made by a database function that (1) checks the signed-in owner is an active owner, (2) records them as the actor in the append-only history and (3) writes the audit row **in the same transaction**: a change cannot exist without its audit record, and a refused change leaves no trace (both are tested). A booking can never be double booked, whoever makes it (the database refuses overlapping use of a table).

Owner API failure behaviour: no "request mode". If the database cannot be reached the answer is `503 service_unavailable` (never `401`, the session is not destroyed, nothing is guessed). If a change's outcome cannot be confirmed: `503 outcome_unknown` (the change may have been applied: look at the reservation before repeating it; a blind repeat of a status change is refused with `409`).

## Running it
See [SETUP.md](SETUP.md): `backend/scripts/api-dev.sh` (starts both processes), `backend/scripts/create-owner.sh` (fake development owner), `backend/scripts/api-test.sh` (type-check + all API tests against a throw-away database).
