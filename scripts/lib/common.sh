#!/usr/bin/env bash
# Shared helpers for the local development database scripts. Source this file; do not run it.
# SAFETY: these scripts only ever talk to the local Docker database created by database/docker-compose.yml.
# They refuse to run if the target looks like anything other than a development/test database.

# Container tools installed from the official release files into a user-owned folder (no Homebrew, no sudo).
NC_TOOLS="$HOME/.local/newscafe-tools"
[ -d "$NC_TOOLS/bin" ] && export PATH="$NC_TOOLS/bin:$NC_TOOLS/lima/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/database/.env"
COMPOSE_FILE="$ROOT/database/docker-compose.yml"
TOOLS_IMAGE="newscafe-tools:local"
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1"

die() { echo "ERROR: $*" >&2; exit 1; }

# docker compose v2 plugin if available, otherwise the standalone docker-compose binary.
compose() {
  local cmd
  if docker compose version >/dev/null 2>&1; then cmd=(docker compose); else cmd=(docker-compose); fi
  "${cmd[@]}" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Refuses to continue unless Docker talks to the LOCAL Colima engine on this computer.
# DOCKER_HOST / DOCKER_CONTEXT could silently redirect every docker command to another machine, so they must be unset.
# (GitHub's CI runner has no Colima: there the only accepted engine is its own default local socket.)
need_docker() {
  local v ctx host
  for v in DOCKER_HOST DOCKER_CONTEXT; do
    [ -z "${!v:-}" ] || die "$v is set in your shell. Unset it; these scripts only use the local Colima engine."
  done
  command -v docker >/dev/null 2>&1 || die "docker is not installed. See docs/SETUP.md (Colima)."
  ctx="$(docker context show 2>/dev/null)" || die "Cannot read the Docker context."
  host="$(docker context inspect "$ctx" --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || die "Cannot inspect Docker context '$ctx'."
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    [ "$host" = "unix:///var/run/docker.sock" ] || die "CI must use the runner's local Docker socket (got '$host')."
  else
    [ "$ctx" = "colima" ] || die "Docker context is '$ctx', not 'colima'. Run: docker context use colima"
    [ "$host" = "unix://$HOME/.colima/default/docker.sock" ] || die "The 'colima' context points at '$host', not the local Colima socket."
    docker info >/dev/null 2>&1 || die "The container runtime is not running. Start it with: scripts/colima-up.sh"
    [ "$(docker info --format '{{.Name}}' 2>/dev/null)" = "colima" ] || die "The Docker engine is not the local Colima engine."
  fi
  docker info >/dev/null 2>&1 || die "The container runtime is not running. Start it with: scripts/colima-up.sh"
}

# Reads database/.env as PLAIN DATA (KEY=VALUE lines). It is never executed as shell code.
# Only the known keys are accepted, each once, with simple values (letters, digits, _ . -), so nothing in the file can run or expand.
load_env_file() {
  local line key val seen=" "
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue;; esac
    [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]] || die "database/.env has a line that is not KEY=VALUE (line contents not shown)."
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    case "$key" in APP_ENV|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|POSTGRES_PORT) ;; *) die "database/.env has an unknown key '$key'.";; esac
    case "$seen" in *" $key "*) die "database/.env sets $key more than once.";; esac
    [[ "$val" =~ ^[A-Za-z0-9_.-]*$ ]] || die "database/.env value for $key has characters that are not allowed (letters, digits, _ . - only)."
    seen="$seen$key "
    export "$key=$val"
  done < "$ENV_FILE"
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
