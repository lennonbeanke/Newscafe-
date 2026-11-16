#!/usr/bin/env bash
# Simultaneous-booking tests (committed data, throw-away database). Usage: 20_concurrency.sh <dbname>
# Fires many parallel sessions at the same slot and checks that no table is ever double booked.
set -euo pipefail
. "$(dirname "$0")/../../scripts/lib/common.sh"
guard_dev
DB="${1:?database name}"
[[ "$DB" =~ ^newscafe_test ]] || die "Concurrency tests only run on newscafe_test* databases."

psql_db "$DB" -f - <<'SQL'
INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'CONC one table', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000e2', 'CONC 44 tables', '1 Test St', 'T', 'T', 'T', '0000');
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at)
SELECT l, d, time '00:00', time '23:59' FROM unnest(ARRAY['00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2']::uuid[]) l, generate_series(1,7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
  max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
SELECT l, 30, 0, 1, 10, 0, 3650, 0 FROM unnest(ARRAY['00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2']::uuid[]) l;
INSERT INTO duration_rules (location_id, name, duration_minutes)
SELECT l, 'default', 90 FROM unnest(ARRAY['00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2']::uuid[]) l;
INSERT INTO dining_tables (location_id, label, min_covers, max_covers) VALUES ('00000000-0000-4000-8000-0000000000e1', 'ONLY', 1, 4);
INSERT INTO dining_tables (location_id, label, min_covers, max_covers)
SELECT '00000000-0000-4000-8000-0000000000e2', 'T' || lpad(n::text, 2, '0'), 1, 2 FROM generate_series(1, 44) n;
SQL

SLOT="$(date -u -v+20d +%Y-%m-%d 2>/dev/null || date -u -d '+20 days' +%Y-%m-%d) 17:00:00+00"   # 19:00 Johannesburg

# run_parallel <location> <requests>  -> prints how many succeeded and how many were refused with NC002
run_parallel() {
  local loc="$1" n="$2" out
  out="$(compose exec -T db sh -c "
    for i in \$(seq 1 $n); do
      ( psql -X -q -tA -U '$POSTGRES_USER' -d '$DB' -c \"SELECT 'OK ' || book_reservation('$loc', 2, '$SLOT', 'Test Guest ' || \$i, 'g\$i@example.com', '+27000000000', NULL, 'web', true, now(), NULL)\" 2>&1 | sed -e 's/^ERROR:.*No suitable table.*/REFUSED/' ) &
    done; wait")"
  echo "$out"
}

echo "-- 60 simultaneous requests for the ONE free table"
R1="$(run_parallel 00000000-0000-4000-8000-0000000000e1 60)"
OK1="$(echo "$R1" | grep -c '^OK ' || true)"; REF1="$(echo "$R1" | grep -c 'REFUSED' || true)"
echo "   succeeded: $OK1, refused (no table): $REF1, other: $((60 - OK1 - REF1))"
[ "$OK1" = "1" ] || die "expected exactly 1 successful booking, got $OK1"
[ "$((OK1 + REF1))" = "60" ] || die "unexpected errors in concurrency run:\n$R1"

echo "-- 120 simultaneous requests for 44 tables"
R2="$(run_parallel 00000000-0000-4000-8000-0000000000e2 120)"
OK2="$(echo "$R2" | grep -c '^OK ' || true)"; REF2="$(echo "$R2" | grep -c 'REFUSED' || true)"
echo "   succeeded: $OK2, refused (no table): $REF2, other: $((120 - OK2 - REF2))"
[ "$OK2" = "44" ] || die "expected exactly 44 successful bookings, got $OK2"
[ "$((OK2 + REF2))" = "120" ] || die "unexpected errors in concurrency run:\n$R2"

echo "-- verifying the database"
psql_db "$DB" -tA -c "
 SELECT 'allocations_active=' || count(*) FROM table_allocations a JOIN dining_tables t ON t.id=a.table_id
  WHERE a.active AND t.location_id IN ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2');
 SELECT 'tables_with_more_than_one_booking=' || count(*) FROM (
   SELECT table_id FROM table_allocations WHERE active GROUP BY table_id HAVING count(*) > 1) x;
 SELECT 'reservations_without_allocation=' || count(*) FROM reservations r
  WHERE r.location_id IN ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2')
    AND NOT EXISTS (SELECT 1 FROM table_allocations a WHERE a.reservation_id = r.id);"
BAD="$(psql_db "$DB" -tA -c "SELECT count(*) FROM (SELECT table_id FROM table_allocations WHERE active GROUP BY table_id HAVING count(*) > 1) x")"
ORPH="$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservations r WHERE NOT EXISTS (SELECT 1 FROM table_allocations a WHERE a.reservation_id = r.id)")"
[ "$BAD" = "0" ] || die "a table was double booked"
[ "$ORPH" = "0" ] || die "a reservation exists without a table"
echo "ok - concurrency: no table double booked, no reservation without a table"
