#!/usr/bin/env bash
# RECOVERY DRILL (development database -> throw-away copy). Steps:
#   1 encrypted backup of the dev database   2 restore into newscafe_test_restore using only the key
#   3 compare row counts of every table      4 confirm the double-booking protection still works
#   5 report timings and remove the throw-away copy
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
TARGET=newscafe_test_restore
COUNTS_SQL="SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
              FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

T0=$(date +%s)
echo "== 1. encrypted backup of $POSTGRES_DB"
"$ROOT/scripts/backup.sh"
FILE="$(cat "$ROOT/database/backups/.latest")"
T1=$(date +%s)

echo "== 2. restore into $TARGET (decrypting with the key only)"
"$ROOT/scripts/restore.sh" "$FILE" "$TARGET"
T2=$(date +%s)

echo "== 3. compare row counts (every table)"
SRC="$(psql_db "$POSTGRES_DB" -tA -c "$COUNTS_SQL")"
DST="$(psql_db "$TARGET" -tA -c "$COUNTS_SQL")"
if [ "$SRC" != "$DST" ]; then
  diff <(echo "$SRC") <(echo "$DST") || true
  die "Row counts differ between the original and the restored copy."
fi
echo "   $(echo "$SRC" | wc -l | tr -d ' ') tables compared, all row counts identical"
echo "   reservations: $(echo "$SRC" | grep '^reservations|' | cut -d'|' -f2), table_allocations: $(echo "$SRC" | grep '^table_allocations|' | cut -d'|' -f2)"

echo "== 4. safety checks on the restored copy"
psql_db "$TARGET" -f - < "$ROOT/database/tests/restored_checks.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  /   /p'
T3=$(date +%s)

drop_db "$TARGET"
echo "== RECOVERY DRILL PASSED  (backup $((T1-T0))s, restore $((T2-T1))s, verification $((T3-T2))s, total $((T3-T0))s)"
