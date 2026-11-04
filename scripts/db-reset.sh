#!/usr/bin/env bash
# Drops and recreates ONLY the local development database, then migrates and seeds it with fake data.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
drop_db "$POSTGRES_DB"
create_db "$POSTGRES_DB"
migrate_db "$POSTGRES_DB" development
"$ROOT/scripts/db-seed.sh"
