#!/usr/bin/env bash
# Turns on LOGIN for the two API database roles (newscafe_public, newscafe_admin) with the random DEVELOPMENT passwords
# from backend/.env.public and backend/.env.admin. Run after the migrations (0008 creates the roles NOLOGIN without passwords). Idempotent.
# The passwords travel on stdin only, never on a command line. Development cluster only (guards from common.sh apply).
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
"$ROOT/scripts/gen-api-env.sh" >/dev/null
load_env_file "$API_PUBLIC_ENV_FILE" $API_PUBLIC_ENV_KEYS
load_env_file "$API_ADMIN_ENV_FILE" $API_ADMIN_ENV_KEYS
[ "$API_DB_PUBLIC_USER" = "newscafe_public" ] && [ "$API_DB_ADMIN_USER" = "newscafe_admin" ] || die "Unexpected API role names in backend/.env.public / backend/.env.admin."
[ "${#API_DB_PUBLIC_PASSWORD}" -ge 32 ] && [ "${#API_DB_ADMIN_PASSWORD}" -ge 32 ] || die "API role passwords are too short."
[ "$API_DB_PUBLIC_PASSWORD" != "$API_DB_ADMIN_PASSWORD" ] || die "The two API role passwords must differ."
[ "$(psql_maint -tA -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('newscafe_public','newscafe_admin')")" = "2" ] \
  || die "The API roles do not exist yet. Run backend/scripts/db-migrate.sh first."
psql_maint -f - <<SQL
ALTER ROLE newscafe_public WITH LOGIN PASSWORD '$API_DB_PUBLIC_PASSWORD' CONNECTION LIMIT 20;
ALTER ROLE newscafe_admin  WITH LOGIN PASSWORD '$API_DB_ADMIN_PASSWORD'  CONNECTION LIMIT 10;
SQL
echo "API database roles can now log in (development passwords from backend/.env.public and backend/.env.admin)."
