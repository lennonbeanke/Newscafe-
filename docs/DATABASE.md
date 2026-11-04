# Database (PostgreSQL 17)

Source of truth: `database/migrations/*.sql` (forward-only, applied in order, checksummed; a changed migration is refused).
Money is stored in cents. Times are `timestamptz` (UTC) shown in `Africa/Johannesburg`. Weekdays are ISO (1 = Monday ... 7 = Sunday).
Migrations contain **no real data**: the owner enters hours, tables, rules and the menu in the admin dashboard.

## Environments
`app_environment` holds one immutable row (`development` / `staging` / `production`). It is set once by the migration script and cannot be changed or deleted. Safeguards that depend on it:
* **Fake e-mail block:** in `production`, `@example.invalid` addresses are rejected (error `NC901`) on reservations, contact messages, function enquiries and admin users.
* **Seed guard:** `database/seed/dev_seed.sql` refuses to run unless the database is named `newscafe_dev`, is labelled `development` and is empty.
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

## Error codes
`NC001` rules not configured · `NC002` no suitable table · `NC004` party size not allowed · `NC005` outside notice/advance window · `NC006` start not on a slot · `NC007` closed at that time · `NC008` consent missing · `NC900` append-only/immutable · `NC901` test e-mail in production · `NC903` allocation/time change not allowed · `23P01` overlap (PostgreSQL exclusion violation).

## Not in this milestone
No API server, no owner login code, no password hashing (the schema only stores hashes), no e-mail sending, no real menu data, no frontend connection. See [API.md](API.md).
