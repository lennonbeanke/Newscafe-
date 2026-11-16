#!/usr/bin/env bash
# Applies pending migrations to the development database (newscafe_dev), labelled 'development'.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
migrate_db "$POSTGRES_DB" development
echo "Migrations are up to date."
