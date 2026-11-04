#!/usr/bin/env bash
# Encrypted backup of the DEVELOPMENT database: pg_dump (custom format) -> age encryption -> database/backups/*.dump.age
# The unencrypted dump is never written to disk: it is streamed straight into the encryption step.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
KEYDIR="$ROOT/database/backups/keys"
[ -f "$KEYDIR/dev-drill.pub" ] || "$ROOT/scripts/backup-keygen.sh"
docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 || docker build -q -t "$TOOLS_IMAGE" "$ROOT/database/tools" >/dev/null
umask 077
OUT="$ROOT/database/backups/${POSTGRES_DB}-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | docker run --rm -i "$TOOLS_IMAGE" age -r "$(cat "$KEYDIR/dev-drill.pub")" > "$OUT"
[ -s "$OUT" ] || { rm -f "$OUT"; die "backup is empty"; }
chmod 600 "$OUT"
echo "Backup written: ${OUT#$ROOT/} ($(wc -c < "$OUT" | tr -d ' ') bytes, encrypted)"
echo "$OUT" > "$ROOT/database/backups/.latest"
