#!/usr/bin/env bash
# Creates a DEVELOPMENT-ONLY backup key pair for the recovery drill. The private key is written to a
# git-ignored folder and is NEVER printed. (The real production key is generated offline by the owner later.)
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
KEYDIR="$ROOT/database/backups/keys"
[ ! -e "$KEYDIR/dev-drill.key" ] || { echo "Dev drill key already exists; leaving it untouched."; exit 0; }
docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 || docker build -q -t "$TOOLS_IMAGE" "$ROOT/database/tools" >/dev/null
umask 077
mkdir -p "$KEYDIR"
docker run --rm "$TOOLS_IMAGE" age-keygen 2>/dev/null > "$KEYDIR/dev-drill.key"
grep '^# public key:' "$KEYDIR/dev-drill.key" | sed 's/^# public key: //' > "$KEYDIR/dev-drill.pub"
chmod 600 "$KEYDIR/dev-drill.key"
echo "Created dev-only drill key pair in database/backups/keys (git-ignored). Public key: $(cat "$KEYDIR/dev-drill.pub")"
