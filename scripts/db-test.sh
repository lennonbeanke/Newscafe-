#!/usr/bin/env bash
# Runs the full database test suite against throw-away databases (newscafe_test, newscafe_test_prod).
# The development database and your fake data are never touched.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev

DB=newscafe_test
echo "== preparing $DB"
drop_db "$DB"; create_db "$DB"
migrate_db "$DB" development
psql_db "$DB" -f - < "$ROOT/database/tests/lib.sql" >/dev/null

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
echo "== script guards (Docker engine, .env parsing)"
"$ROOT/database/tests/40_script_guards.sh"
drop_db "$DB"
echo "ALL DATABASE TESTS PASSED"
