#!/usr/bin/env bash
# Restores an encrypted backup into a NEW throw-away database (never over newscafe_dev).
# Usage: scripts/restore.sh <backup.dump.age> <target_db>   (target must be named newscafe_test*)
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
FILE="${1:?backup file}"; TARGET="${2:?target database (newscafe_test_...)}"
[[ "$TARGET" =~ ^newscafe_test ]] || die "Restore target must be a newscafe_test* database (never newscafe_dev)."
[ -f "$FILE" ] || die "No such backup: $FILE"
KEY="$ROOT/database/backups/keys/dev-drill.key"
[ -f "$KEY" ] || die "Dev drill key not found."
docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 || docker build -q -t "$TOOLS_IMAGE" "$ROOT/database/tools" >/dev/null
drop_db "$TARGET"; create_db "$TARGET"
docker run --rm -i -v "$KEY:/key:ro" "$TOOLS_IMAGE" age -d -i /key < "$FILE" \
  | compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$TARGET" --no-owner --exit-on-error
echo "Restored $(basename "$FILE") into $TARGET."
