#!/usr/bin/env bash
# REAL-LOGIN tests for the two API roles (newscafe_public, newscafe_admin) against a throw-away database.
#  * password authentication is enforced (connections go to the container's network address, never the trusted loopback)
#  * a logged-in API role cannot switch role, read secrets, run programs, read files or create anything
#  * parallel requests through the public booking function and the admin status function never double book
# Usage: 45_api_logins.sh <dbname>   (a newscafe_test* database; it is created and dropped here). Fake data only.
set -euo pipefail
. "$(dirname "$0")/../../scripts/lib/common.sh"
guard_dev
DB="${1:?database name}"
[[ "$DB" =~ ^newscafe_test ]] || die "Login tests only run on newscafe_test* databases."
load_env_file "$API_PUBLIC_ENV_FILE" $API_PUBLIC_ENV_KEYS
load_env_file "$API_ADMIN_ENV_FILE" $API_ADMIN_ENV_KEYS
PUB_PW="$API_DB_PUBLIC_PASSWORD"; ADM_PW="$API_DB_ADMIN_PASSWORD"
OWNER=00000000-0000-4000-8000-0000000000d1
L1=00000000-0000-4000-8000-0000000000e1
L2=00000000-0000-4000-8000-0000000000e2

drop_db "$DB"; create_db "$DB"
migrate_db "$DB" development >/dev/null
trap 'drop_db "$DB" >/dev/null 2>&1 || true' EXIT

# Everything below talks to the database through the container's own network address, where passwords are required.
# The password is sent on stdin so it never appears on a command line.
as_role() {   # as_role <role> <password> <sql>  -> prints the first output line (query result or "ERR <message>")
  local role="$1" pw="$2" sql="$3"
  printf '%s\n' "$pw" | compose exec -T db sh -c 'read -r PGPASSWORD; export PGPASSWORD
    psql -X -q -tA -w -h "$(hostname -i)" -U "$1" -d "$2" -c "$3" 2>&1 | head -1 | sed -e "s/^ERROR: */ERR /" -e "s/^psql: error: .*FATAL: */ERR /" -e "s/^psql: error: /ERR /" -e "/^ERR /!s/^/OK /"' sh "$role" "$DB" "$sql"
}
expect_err() {   # expect_err <role> <pw> <sql> <substring> <description>
  local out; out="$(as_role "$1" "$2" "$3")"
  case "$out" in "ERR "*"$4"*) echo "ok - $5";; *) die "login test FAILED: $5 (got: $out)";; esac
}
expect_ok() {    # expect_ok <role> <pw> <sql> <expected> <description>
  local out; out="$(as_role "$1" "$2" "$3")"
  [ "$out" = "OK $4" ] || die "login test FAILED: $5 (got: $out, wanted: OK $4)"
  echo "ok - $5"
}

# Runs <rounds> rounds of <per_round> parallel connections as one role. SQL may use \$i (the connection number).
# Prints one line per connection: "OK <value>" or "ERR <message>".
parallel_as() {  # parallel_as <role> <password> <rounds> <per_round> <sql>
  local role="$1" pw="$2" rounds="$3" per="$4" sql="$5"
  compose exec -T db sh -s <<EOF
export PGPASSWORD='$pw'
n=0
for r in \$(seq 1 $rounds); do
  for k in \$(seq 1 $per); do
    n=\$((n+1)); i=\$n
    ( psql -X -q -tA -w -h "\$(hostname -i)" -U '$role' -d '$DB' -c "$sql" 2>&1 | head -1 \\
        | sed -e 's/^ERROR: */ERR /' -e '/^ERR /!s/^/OK /' ) &
  done
  wait
done
EOF
}

psql_db "$DB" -f - <<SQL >/dev/null
INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES
  ('$L1', 'LIVE one table', '1 Test St', 'T', 'T', 'T', '0000'),
  ('$L2', 'LIVE 44 tables', '1 Test St', 'T', 'T', 'T', '0000');
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at)
SELECT l, d, time '00:00', time '23:59' FROM unnest(ARRAY['$L1','$L2']::uuid[]) l, generate_series(1,7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
  max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
SELECT l, 30, 0, 1, 10, 0, 3650, 0 FROM unnest(ARRAY['$L1','$L2']::uuid[]) l;
INSERT INTO duration_rules (location_id, name, duration_minutes) SELECT l, 'default', 90 FROM unnest(ARRAY['$L1','$L2']::uuid[]) l;
INSERT INTO dining_tables (location_id, label, min_covers, max_covers) VALUES ('$L1', 'ONLY', 1, 4);
INSERT INTO dining_tables (location_id, label, min_covers, max_covers)
SELECT '$L2', 'T' || lpad(n::text, 2, '0'), 1, 2 FROM generate_series(1, 44) n;
INSERT INTO admin_users (id, email, password_hash, role) VALUES ('$OWNER', 'owner@example.invalid', 'not-a-real-hash', 'owner');
UPDATE locations SET is_active = false WHERE id = '$L2';     -- scenario 1 uses only L1 (the API serves exactly one active venue)
SQL

echo "== passwords are enforced"
expect_err newscafe_public "wrong-password" "SELECT 1" "password authentication failed" "public role with a wrong password is refused"
expect_err newscafe_public "$ADM_PW"        "SELECT 1" "password authentication failed" "public role with the admin password is refused"
expect_err newscafe_admin  "$PUB_PW"        "SELECT 1" "password authentication failed" "admin role with the public password is refused"
expect_err newscafe_definer "anything"      "SELECT 1" "newscafe_definer" "the definer role cannot log in at all"
expect_err newscafe_public ""               "SELECT 1" "password" "an empty password is refused"
expect_ok  newscafe_public "$PUB_PW" "SELECT current_user || '/' || session_user" "newscafe_public/newscafe_public" "public role logs in with its own password"
expect_ok  newscafe_admin  "$ADM_PW" "SELECT current_user" "newscafe_admin" "admin role logs in with its own password"

echo "== a logged-in public role cannot escalate"
expect_err newscafe_public "$PUB_PW" "SET ROLE newscafe_definer" "permission denied" "cannot become the definer role"
expect_err newscafe_public "$PUB_PW" "SET ROLE newscafe_admin" "permission denied" "cannot become the admin role"
expect_err newscafe_public "$PUB_PW" "SET ROLE $POSTGRES_USER" "permission denied" "cannot become the superuser"
expect_err newscafe_public "$PUB_PW" "SET SESSION AUTHORIZATION $POSTGRES_USER" "permission denied" "cannot change session authorization"
expect_ok  newscafe_public "$PUB_PW" "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication FROM pg_roles WHERE rolname = current_user" "f" "has no elevated attributes"
expect_err newscafe_public "$PUB_PW" "SELECT rolpassword FROM pg_authid" "permission denied" "cannot read password hashes (pg_authid)"
expect_err newscafe_public "$PUB_PW" "SELECT count(*) FROM reservations" "permission denied" "cannot read reservations"
expect_err newscafe_public "$PUB_PW" "SELECT count(*) FROM admin_users" "permission denied" "cannot read owner accounts"
expect_err newscafe_public "$PUB_PW" "CREATE TABLE sneaky (a int)" "permission denied" "cannot create tables"
expect_err newscafe_public "$PUB_PW" "CREATE TEMP TABLE sneaky (a int)" "permission denied" "cannot create temporary tables"
expect_err newscafe_public "$PUB_PW" "CREATE SCHEMA evil" "permission denied" "cannot create schemas (no search_path planting)"
expect_err newscafe_public "$PUB_PW" "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1'" "permission denied" "cannot create functions"
expect_err newscafe_public "$PUB_PW" "COPY (SELECT 1) TO PROGRAM 'id'" "permission denied" "cannot run programs"
expect_err newscafe_public "$PUB_PW" "SELECT pg_read_file('/etc/passwd')" "permission denied" "cannot read server files"
expect_err newscafe_public "$PUB_PW" "ALTER ROLE newscafe_public SUPERUSER" "permission denied" "cannot grant itself superuser"
expect_err newscafe_public "$PUB_PW" "SELECT * FROM book_reservation('$L1',2,now(),'x','x@example.com',NULL)" "permission denied" "cannot call book_reservation directly"
echo "== a logged-in admin role cannot escalate"
expect_err newscafe_admin "$ADM_PW" "SET ROLE newscafe_definer" "permission denied" "cannot become the definer role"
expect_err newscafe_admin "$ADM_PW" "SET ROLE $POSTGRES_USER" "permission denied" "cannot become the superuser"
expect_err newscafe_admin "$ADM_PW" "SELECT rolpassword FROM pg_authid" "permission denied" "cannot read password hashes (pg_authid)"
expect_err newscafe_admin "$ADM_PW" "UPDATE audit_logs SET action = 'x'" "permission denied" "cannot edit the audit log"
expect_err newscafe_admin "$ADM_PW" "COPY (SELECT 1) TO PROGRAM 'id'" "permission denied" "cannot run programs"
expect_err newscafe_admin "$ADM_PW" "CREATE TABLE sneaky (a int)" "permission denied" "cannot create tables"
expect_err newscafe_admin "$ADM_PW" "SELECT * FROM public_book_reservation(2,now(),'x','x@example.com',NULL,NULL,true,'0123456789abcdef0123')" "permission denied" "cannot use the public booking function"

echo "== 60 parallel public bookings for the ONE free table (20 connections at a time, the role limit)"
SLOT="$(date -u -v+20d +%Y-%m-%d 2>/dev/null || date -u -d '+20 days' +%Y-%m-%d) 17:00:00+00"
R="$(parallel_as newscafe_public "$PUB_PW" 3 20 "SELECT out_reference FROM public_book_reservation(2, '$SLOT', 'Guest '||\$i, 'g'||\$i||'@example.com', '+27000000000', NULL, true, 'conc-one-table-key-'||\$i)")"
OK="$(echo "$R" | grep -c '^OK ' || true)"; NO="$(echo "$R" | grep -c 'ERR No suitable table' || true)"
echo "   succeeded: $OK, refused (no table): $NO, other: $((60 - OK - NO))"
[ "$OK" = "1" ] || die "expected exactly 1 successful booking, got $OK"
[ "$((OK + NO))" = "60" ] || die "unexpected errors:\n$(echo "$R" | sort | uniq -c)"
[ "$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservations WHERE location_id = '$L1'")" = "1" ] || die "more than one reservation exists for the single table"

psql_db "$DB" -c "UPDATE locations SET is_active = false WHERE id = '$L1'; UPDATE locations SET is_active = true WHERE id = '$L2'" >/dev/null
echo "== 120 parallel public bookings for 44 tables"
R="$(parallel_as newscafe_public "$PUB_PW" 6 20 "SELECT out_reference FROM public_book_reservation(2, '$SLOT', 'Guest '||\$i, 'h'||\$i||'@example.com', '+27000000000', NULL, true, 'conc-44-tables-key-'||\$i)")"
OK="$(echo "$R" | grep -c '^OK ' || true)"; NO="$(echo "$R" | grep -c 'ERR No suitable table' || true)"
echo "   succeeded: $OK, refused (no table): $NO, other: $((120 - OK - NO))"
[ "$OK" = "44" ] || die "expected exactly 44 successful bookings, got $OK"
[ "$((OK + NO))" = "120" ] || die "unexpected errors:\n$(echo "$R" | sort | uniq -c)"
BAD="$(psql_db "$DB" -tA -c "SELECT count(*) FROM (SELECT table_id FROM table_allocations WHERE active GROUP BY table_id HAVING count(*) > 1) x")"
ORPH="$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservations r WHERE NOT EXISTS (SELECT 1 FROM table_allocations a WHERE a.reservation_id = r.id)")"
[ "$BAD" = "0" ] && [ "$ORPH" = "0" ] || die "double booking ($BAD) or reservation without a table ($ORPH)"
echo "ok - no table double booked, no reservation without a table"

echo "== the same request sent 20 times at once (same idempotency key)"
SLOT2="$(date -u -v+21d +%Y-%m-%d 2>/dev/null || date -u -d '+21 days' +%Y-%m-%d) 17:00:00+00"
R="$(parallel_as newscafe_public "$PUB_PW" 1 20 "SELECT out_reference FROM public_book_reservation(2, '$SLOT2', 'Same Guest', 'same@example.com', '+27000000000', NULL, true, 'same-key-same-request-01')")"
OK="$(echo "$R" | grep -c '^OK ' || true)"; REFS="$(echo "$R" | grep '^OK ' | sort -u | wc -l | tr -d ' ')"
echo "   succeeded: $OK, distinct references: $REFS"
[ "$OK" = "20" ] && [ "$REFS" = "1" ] || die "identical retries must all return the same booking:\n$(echo "$R" | sort | uniq -c)"
[ "$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservations WHERE idempotency_key = 'same-key-same-request-01'")" = "1" ] || die "duplicate reservation rows for one key"
echo "ok - 20 identical simultaneous requests produced exactly one booking"
echo "== one key, two DIFFERENT requests at once"
SLOT3="$(date -u -v+22d +%Y-%m-%d 2>/dev/null || date -u -d '+22 days' +%Y-%m-%d) 17:00:00+00"
R="$(parallel_as newscafe_public "$PUB_PW" 1 20 "SELECT out_reference FROM public_book_reservation(1 + (\$i % 2), '$SLOT3', 'Mixed Guest', 'mixed@example.com', '+27000000000', NULL, true, 'same-key-mixed-request-1')")"
OK="$(echo "$R" | grep -c '^OK ' || true)"; CF="$(echo "$R" | grep -c 'ERR That idempotency key was already used' || true)"; REFS="$(echo "$R" | grep '^OK ' | sort -u | wc -l | tr -d ' ')"
echo "   succeeded: $OK (distinct references: $REFS), key-conflict refusals: $CF"
[ "$((OK + CF))" = "20" ] && [ "$REFS" = "1" ] && [ "$CF" -gt 0 ] || die "a key must belong to exactly one request:\n$(echo "$R" | sort | uniq -c)"
[ "$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservations WHERE idempotency_key = 'same-key-mixed-request-1'")" = "1" ] || die "duplicate reservation rows for one key"
echo "ok - the losing request shape was refused, never given the other guest's booking"

echo "== 20 admin confirmations of one pending booking (10 at a time, the role limit)"
RID="$(psql_db "$DB" -tA -c "SELECT id FROM reservations WHERE idempotency_key = 'same-key-same-request-01'")"
R="$(parallel_as newscafe_admin "$ADM_PW" 2 10 "SELECT admin_set_reservation_status('$OWNER', '$RID', 'confirmed', NULL, 'iphash')")"
OK="$(echo "$R" | grep -c '^OK confirmed' || true)"; NO="$(echo "$R" | grep -c 'ERR Cannot change a confirmed reservation' || true)"
echo "   succeeded: $OK, refused (already confirmed): $NO"
[ "$OK" = "1" ] && [ "$((OK + NO))" = "20" ] || die "exactly one confirmation must win:\n$(echo "$R" | sort | uniq -c)"
[ "$(psql_db "$DB" -tA -c "SELECT count(*) FROM audit_logs WHERE entity_id = '$RID' AND action = 'reservation.status'")" = "1" ] || die "audit must hold exactly one status row"
[ "$(psql_db "$DB" -tA -c "SELECT count(*) FROM reservation_events WHERE reservation_id = '$RID' AND action = 'status_changed'")" = "1" ] || die "history must hold exactly one status change"
echo "ok - one winner, one audit row, one history entry"

echo "== 20 staff bookings for one table (10 at a time)"
psql_db "$DB" -c "UPDATE locations SET is_active = false WHERE id = '$L2'; UPDATE locations SET is_active = true WHERE id = '$L1'" >/dev/null
SLOT4="$(date -u -v+23d +%Y-%m-%d 2>/dev/null || date -u -d '+23 days' +%Y-%m-%d) 17:00:00+00"
R="$(parallel_as newscafe_admin "$ADM_PW" 2 10 "SELECT admin_create_reservation('$OWNER', 2, '$SLOT4', 'Staff '||\$i, 's'||\$i||'@example.com', NULL, NULL, 'phone', true, 'staff-conc-key-'||\$i, 'iphash')")"
OK="$(echo "$R" | grep -c '^OK ' || true)"; NO="$(echo "$R" | grep -c 'ERR No suitable table' || true)"
echo "   succeeded: $OK, refused (no table): $NO"
[ "$OK" = "1" ] && [ "$((OK + NO))" = "20" ] || die "exactly one staff booking must win the single table:\n$(echo "$R" | sort | uniq -c)"
echo "ok - staff bookings cannot double book either"
echo "login tests passed"
