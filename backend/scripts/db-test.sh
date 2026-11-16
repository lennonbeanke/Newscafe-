#!/usr/bin/env bash
# Runs the full database test suite against throw-away databases (newscafe_test, newscafe_test_prod, newscafe_test_api, newscafe_test_apilogin).
# The development database and your fake data are never touched.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev

DB=newscafe_test
echo "== preparing $DB"
drop_db "$DB"; create_db "$DB"
migrate_db "$DB" development
psql_db "$DB" -f - < "$ROOT/database/tests/lib.sql" >/dev/null
"$ROOT/scripts/db-roles.sh" >/dev/null   # API roles can log in (fake dev passwords from backend/.env)

echo "== structure"
OUT="$(psql_db "$DB" -f - < "$ROOT/database/tests/00_schema.sql" 2>&1)" || { echo "$OUT"; die "structure tests FAILED"; }
echo "$OUT" | grep -E "ok - " | sed 's/^psql:[^ ]* NOTICE:  //'
echo "== reservation logic"
OUT="$(psql_db "$DB" -f - < "$ROOT/database/tests/10_reservations.sql" 2>&1)" || { echo "$OUT"; die "reservation tests FAILED"; }
echo "$OUT" | grep -E "ok - |finished" | sed 's/^psql:[^ ]* NOTICE:  //' 
echo "   $(echo "$OUT" | grep -c 'ok - ') checks passed"
echo "== simultaneous bookings"
"$ROOT/database/tests/20_concurrency.sh" "$DB"
echo "== production safeguards"
"$ROOT/database/tests/30_production_guard.sh" newscafe_test_prod
echo "== API roles, privileges and admin actions"
API_DB=newscafe_test_api
drop_db "$API_DB"; create_db "$API_DB"
migrate_db "$API_DB" development >/dev/null
psql_db "$API_DB" -f - < "$ROOT/database/tests/lib.sql" >/dev/null
OUT="$(psql_db "$API_DB" -f - < "$ROOT/database/tests/50_api_roles.sql" 2>&1)" || { echo "$OUT"; die "API role tests FAILED"; }
echo "   $(echo "$OUT" | grep -c 'NOTICE:  ok - ') checks passed (privileges, actor checks, status changes, edits, moves, audit)"
echo "== availability (offered slots vs real bookings)"
OUT="$(psql_db "$API_DB" -f - < "$ROOT/database/tests/60_api_functions.sql" 2>&1)" || { echo "$OUT"; die "availability tests FAILED"; }
echo "$OUT" | grep -E "NOTICE:  ok - (L1|L2)" | sed 's/^psql:[^ ]* NOTICE:  //'
echo "   $(echo "$OUT" | grep -c 'NOTICE:  ok - ') checks passed"
drop_db "$API_DB"
echo "== real logins as the API roles (passwords, escalation attempts, parallel requests)"
"$ROOT/database/tests/45_api_logins.sh" newscafe_test_apilogin | grep -E "^(==|   |ok - (no table|20 identical|the losing|one winner|staff)|login tests passed)|FAILED|ERROR"
echo "== script guards (Docker engine, .env parsing)"
"$ROOT/database/tests/40_script_guards.sh"
drop_db "$DB"
echo "ALL DATABASE TESTS PASSED"
