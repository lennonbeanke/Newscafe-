# Database (PostgreSQL 17)

Source of truth: `backend/database/migrations/*.sql` (forward-only, applied in order, checksummed; a changed migration is refused).
Money is stored in cents. Times are `timestamptz` (UTC) shown in `Africa/Johannesburg`. Weekdays are ISO (1 = Monday ... 7 = Sunday).
Migrations contain **no real data**: the owner enters hours, tables, rules and the menu in the admin dashboard.

## Environments
`app_environment` holds one immutable row (`development` / `staging` / `production`). It is set once by the migration script and cannot be changed or deleted. Safeguards that depend on it:
* **Fake e-mail block:** in `production`, `@example.invalid` addresses are rejected (error `NC901`) on reservations, contact messages, function enquiries and admin users.
* **Seed guard:** `backend/database/seed/dev_seed.sql` refuses to run unless the database is named `newscafe_dev`, is labelled `development` and is empty.
* **Script guard:** every script refuses any database other than `newscafe_dev` / `newscafe_test*`; the `production` label is only allowed on `newscafe_test*` databases (used by the guard tests).
* **`is_test` flag:** bookings, contact messages and function enquiries carry `is_test`. Test rows never appear in `reservations_live`.

## Tables
| Group | Tables |
|---|---|
| Settings | `locations`, `site_settings`, `opening_hours`, `special_hours` |
| Menu | `menu_books` → `menu_sections` → `menu_groups` → `menu_items` → `menu_item_prices`, `menu_item_addons`, `menu_item_tradeups`; `menu_settings` (N-badge switch), `menu_price_history` |
| Content | `media_assets`, `promotions`, `promotion_items`, `function_packages` → `package_courses` → `package_course_items`, `events`, `gallery_items` |
| Enquiries | `contact_messages`, `function_enquiries` |
| Reservations | `dining_tables`, `table_combinations` + `table_combination_members`, `reservation_settings`, `duration_rules`, `reservations`, `table_allocations`, `reservation_events` |
| Security | `admin_users`, `admin_sessions`, `login_attempts`, `audit_logs`, `idempotency_keys` |
| System | `app_environment`, `schema_migrations` |

Views: `reservations_live` (no test rows), `reservation_readiness` (what is still missing before online booking / auto-confirm).

## Reservation design
* **Nothing is assumed.** Slot interval, turnaround, party limits, notice, advance window, last seating and durations are all `NULL`/absent until the owner sets them. Without a slot interval and a matching duration rule, `book_reservation()` raises `NC001` and online booking is unavailable.
* **Durations** come from `duration_rules` (by party size, weekday, time of day; highest priority, then most specific wins). Each reservation stores its own `duration_minutes`, so changing a rule never alters existing bookings.
* **No double booking:** `table_allocations` has `EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)`. Two active allocations for the same table cannot overlap, whatever the application does. Combinations allocate one row per member table.
* **`book_reservation()`** is the booking transaction: validates rules, picks the best-fitting free table (one locked candidate at a time, `FOR UPDATE SKIP LOCKED`), inserts reservation + allocation, retries the next table if the constraint reports a conflict, otherwise tries owner-defined combinations, otherwise raises `NC002`. Web bookings never use walk-in-only tables. Staff bookings may.
* **Status:** `pending`, `confirmed`, `cancelled`, `completed`, `no_show`. Cancelled / no-show release the table immediately; reinstating re-checks the constraint (`23P01` if the table was taken). Every change is written to `reservation_events` (append-only).
* **Auto-confirm** is off by default and only applies when the owner switches it on.
* **Moves:** reservation times cannot be edited directly (`NC903`); a later move operation will do it atomically.
* **Retention:** reservations are anonymised rather than deleted (history is append-only).

## API roles and functions (migrations 0008-0009)
| Role | Can do | Cannot do |
|---|---|---|
| `newscafe_public` (public API) | call `public_available_slots`, `public_book_reservation` | read or write any table or view; call `book_reservation` or any admin function |
| `newscafe_admin` (owner API) | read reservations, tables, settings, history, audit; write sessions, login attempts, audit (insert only), lockout state (the former 2FA columns and table are unused but still granted: untouched by decision); call the four `admin_*` functions | write reservations/allocations/history directly; edit or delete audit rows; create owner accounts; DDL |
| `newscafe_definer` (no login) | owns the `SECURITY DEFINER` functions; has only the table privileges they need | log in |
* `public_book_reservation` hard-codes source `web`, not a test booking and consent time = now (the caller only asserts consent); an `Idempotency-Key` makes retries safe, and reusing a key for a different request is refused (`NC905`).
* `available_slots` applies the same rules as `book_reservation`; a test proves every offered slot is bookable and every aligned time not offered is refused (4,608 probes, including past-midnight service and a 50-minute grid).
* `admin_create_reservation`, `admin_set_reservation_status`, `admin_edit_reservation`, `admin_move_reservation`: actor must be an active owner (`NC906`); allowed status changes only (`NC907`); a move is atomic (all or nothing); every action writes `audit_logs` in the same transaction.
* Roles are created without passwords and `NOLOGIN`; `backend/scripts/db-roles.sh` enables login with random development passwords from `backend/.env`. Backups keep ownership and privileges; **a restore into a new cluster needs these roles to exist first** (the recovery drill checks ownership and privileges after restoring).
* Plan B note: moving function ownership to `newscafe_definer` needs a superuser (or `CREATE` on the schema) on the host that runs migrations. Check this when the production host is chosen.

## Owner sign-in data (migrations 0006, 0008, 0010)
`admin_users` (Argon2id hash, `failed_logins`, `locked_until`; the encrypted authenticator secret, `totp_confirmed_at` and `totp_last_step` are UNUSED since sign-in became e-mail + password only, and are kept so nothing is lost), `admin_sessions` (token **hash**, `mfa_pending` (legacy: such a session is never accepted), `last_seen_at`, `expires_at`, `revoked_at`, keyed IP hash), `admin_recovery_codes` (UNUSED since the authenticator was removed; kept), `login_attempts` (keyed hash of address+e-mail only), `audit_logs` (append-only; no guest personal data). The admin login can insert but never edit or delete audit rows, and can never create an owner account. `public_environment()` (0010) lets the public process read the one-word environment label without any table access.

## Error codes
`NC001` rules not configured · `NC002` no suitable table · `NC004` party size not allowed · `NC005` outside notice/advance window · `NC006` start not on a slot · `NC007` closed at that time · `NC008` consent missing · `NC900` append-only/immutable · `NC901` test e-mail in production · `NC903` allocation/time change not allowed · `NC905` idempotency key reused for a different request · `NC906` actor is not an active owner · `NC907` status change not allowed · `NC909` reservation not found · `22023` invalid input · `23P01` overlap (PostgreSQL exclusion violation).

## Not in this milestone
No API server, no owner login code, no password hashing (the schema only stores hashes), no e-mail sending, no real menu data, no frontend connection. See [API.md](API.md).
