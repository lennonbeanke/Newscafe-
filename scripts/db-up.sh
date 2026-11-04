#!/usr/bin/env bash
# Starts the local development database (creates database/.env first if needed).
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
"$ROOT/scripts/gen-env.sh"
need_docker
guard_dev
compose up -d db
wait_for_db
echo "Database is up on 127.0.0.1:${POSTGRES_PORT:-54329} (development only)."
