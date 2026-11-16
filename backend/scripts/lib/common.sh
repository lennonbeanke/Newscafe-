#!/usr/bin/env bash
# Shared helpers for the backend development scripts (database, API, backup). Source this file; do not run it.
# SAFETY: these scripts only ever talk to the local Docker database created by backend/database/docker-compose.yml.
# They refuse to run if the target looks like anything other than a development/test database.


ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"       # the backend/ folder
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
# The Docker-engine guard (need_docker, die) is shared with the repository-level scripts and lives in ONE place:
. "$REPO_ROOT/scripts/lib/docker-guard.sh"
ENV_FILE="$ROOT/database/.env"
# The API runs as TWO processes, each with its own env file holding only its own database credential:
#   backend/.env.public  (public endpoints, login newscafe_public)    backend/.env.admin  (owner endpoints, login newscafe_admin)
API_PUBLIC_ENV_FILE="$ROOT/.env.public"
API_ADMIN_ENV_FILE="$ROOT/.env.admin"
API_PUBLIC_ENV_KEYS="APP_ENV API_PORT API_DB_HOST API_DB_PORT API_DB_NAME API_DB_PUBLIC_USER API_DB_PUBLIC_PASSWORD API_ALLOWED_ORIGIN API_OUTBOX_DIR"
# API_TOTP_ENC_KEY is LEGACY: the owner login has no authenticator any more and the API ignores it. It stays in this allow-list only so an older
# api/.env.admin that still contains the line keeps loading; it is no longer generated.
API_ADMIN_ENV_KEYS="APP_ENV API_ADMIN_PORT API_DB_HOST API_DB_PORT API_DB_NAME API_DB_ADMIN_USER API_DB_ADMIN_PASSWORD API_HMAC_KEY API_TOTP_ENC_KEY API_ADMIN_ALLOWED_ORIGIN"
COMPOSE_FILE="$ROOT/database/docker-compose.yml"
TOOLS_IMAGE="newscafe-tools:local"

# docker compose v2 plugin if available, otherwise the standalone docker-compose binary.
compose() {
  local cmd
  if docker compose version >/dev/null 2>&1; then cmd=(docker compose); else cmd=(docker-compose); fi
  "${cmd[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}


# Reads an env file as PLAIN DATA (KEY=VALUE lines). It is never executed as shell code.
# Only the allowed keys are accepted, each once, with simple values (letters, digits, _ . - : / only), so nothing in the
# file can run or expand. Usage: load_env_file [file] [allowed keys...]   (default: database/.env and its five keys)
load_env_file() {
  local file="${1:-$ENV_FILE}" line key val seen=" " keys
  if [ "$#" -gt 1 ]; then shift; keys=" $* "; else keys=" APP_ENV POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_PORT "; fi
  local name; name="${file#"$ROOT"/}"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue;; esac
    [[ "$line" =~ ^([A-Z_0-9]+)=(.*)$ ]] || die "$name has a line that is not KEY=VALUE (line contents not shown)."
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    case "$keys" in *" $key "*) ;; *) die "$name has an unknown key '$key'.";; esac
    case "$seen" in *" $key "*) die "$name sets $key more than once.";; esac
    [[ "$val" =~ ^[A-Za-z0-9_./:-]*$ ]] || die "$name value for $key has characters that are not allowed (letters, digits, _ . - : / only)."
    seen="$seen$key "
    export "$key=$val"
  done < "$file"
}

# Loads database/.env and refuses to continue unless this is clearly the local development setup.
guard_dev() {
  # A stray connection setting could point psql tools at another server. We never use these, so refuse.
  for v in DATABASE_URL PGHOST PGHOSTADDR PGDATABASE PGSERVICE; do
    [ -z "${!v:-}" ] || die "$v is set in your shell. Unset it; these scripts never connect to remote databases."
  done
  [ -f "$ENV_FILE" ] || die "database/.env is missing. Run scripts/gen-env.sh first."
  load_env_file
  [ "${APP_ENV:-}" = "development" ] || die "APP_ENV must be 'development' (got '${APP_ENV:-unset}'). Production is never handled by these scripts."
  [ "${POSTGRES_DB:-}" = "newscafe_dev" ] || die "POSTGRES_DB must be newscafe_dev."
  [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ] || die "database/.env is incomplete."
}

# Only these database names may ever be created, dropped, migrated or tested.
guard_db_name() {
  [[ "$1" =~ ^newscafe_(dev|test[a-z0-9_]*)$ ]] || die "Refusing to touch database '$1' (only newscafe_dev and newscafe_test* are allowed)."
}

# psql inside the db container against a named database. Usage: psql_db <db> [psql args...]
psql_db() {
  local db="$1"; shift
  guard_db_name "$db"
  compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" "$@"
}

# Maintenance connection used only to create/drop the allowed databases.
psql_maint() {
  compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"
}

wait_for_db() {
  local i
  for i in $(seq 1 60); do
    compose exec -T db pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" && return 0
    sleep 1
  done
  die "Database did not become ready."
}

create_db() { guard_db_name "$1"; psql_maint -c "CREATE DATABASE \"$1\""; }
drop_db()   { guard_db_name "$1"; psql_maint -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)"; }
db_exists() { guard_db_name "$1"; [ "$(psql_maint -tA -c "SELECT 1 FROM pg_database WHERE datname='$1'")" = "1" ]; }

# Apply database/migrations/*.sql to <db> in order, once each, each in its own transaction.
# <label> is the environment label stored in the database (development|staging|production).
# The 'production' label is only allowed for throw-away test databases (used by the guard tests).
migrate_db() {
  local db="$1" label="${2:-development}" f ver sum prev
  guard_db_name "$db"
  case "$label" in development|staging|production) ;; *) die "Bad environment label '$label'";; esac
  if [ "$label" != "development" ] && [[ ! "$db" =~ ^newscafe_test ]]; then
    die "Environment label '$label' is only allowed on newscafe_test* databases."
  fi
  psql_db "$db" -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
  for f in "$ROOT"/database/migrations/*.sql; do
    ver="$(basename "$f")"
    sum="$(shasum -a 256 "$f" | cut -d' ' -f1)"
    prev="$(psql_db "$db" -tA -c "SELECT checksum FROM schema_migrations WHERE version='$ver'")"
    if [ -n "$prev" ]; then
      [ "$prev" = "$sum" ] || die "Migration $ver was modified after it was applied. Add a new migration instead."
      continue
    fi
    echo "  applying $ver"
    # migration + bookkeeping in one transaction
    { cat "$f"; printf "\nINSERT INTO schema_migrations (version, checksum) VALUES ('%s', '%s');\n" "$ver" "$sum"; } \
      | psql_db "$db" --single-transaction -f -
    if [ "$ver" = "0001_extensions_environment.sql" ]; then
      psql_db "$db" -c "INSERT INTO app_environment (env) VALUES ('$label') ON CONFLICT DO NOTHING"
    fi
  done
  local have; have="$(psql_db "$db" -tA -c "SELECT env FROM app_environment")"
  [ "$have" = "$label" ] || die "Database '$db' is labelled '$have' but '$label' was requested."
}
