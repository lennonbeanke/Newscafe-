#!/usr/bin/env bash
# Creates the FAKE development owner account (dev-owner@example.invalid) in the local development database.
# The random password is shown once on the terminal and stored nowhere. Refuses anything that is not the development setup.
# Usage: backend/scripts/create-owner.sh [fake-address@example.invalid]
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
[ -d "$ROOT/node_modules" ] || die "backend/node_modules is missing. Run:  cd backend && npm ci --ignore-scripts"
cd "$ROOT"
# The database superuser is used ONLY by this one-off developer script (the API itself never has it). Passed by environment, not command line.
exec env APP_ENV=development CREATE_OWNER_DB_HOST=127.0.0.1 CREATE_OWNER_DB_PORT="$POSTGRES_PORT" CREATE_OWNER_DB_NAME="$POSTGRES_DB" \
  CREATE_OWNER_DB_USER="$POSTGRES_USER" CREATE_OWNER_DB_PASSWORD="$POSTGRES_PASSWORD" "$(command -v node)" tools/create-owner.ts "$@"
