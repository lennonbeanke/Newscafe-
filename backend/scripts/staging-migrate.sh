#!/usr/bin/env bash
# =====================================================================================================================
# REVIEW COPY. NOT APPROVED TO RUN. Nobody (including the assistant) runs this until the owner says so in writing.
# =====================================================================================================================
# One-off loader: puts the News Cafe database STRUCTURE (the migrations in backend/database/migrations/) into ONE hosted
# STAGING PostgreSQL database: a Supabase project (STAGING_PROVIDER=supabase, the default) or a Neon project (STAGING_PROVIDER=neon).
# It loads NO data: no seed file, no fake or real customers, no owner accounts.
#
# Why a separate script: the everyday database scripts refuse every database except the local newscafe_dev / newscafe_test*
# (see lib/common.sh). They are NOT changed or weakened. This script has its own, stricter guards, and it can only ever
# label the database 'staging' (the label is locked inside the database afterwards and can never be changed).
#
#   bash backend/scripts/staging-migrate.sh plan                                    offline: shows what would happen. No connection.
#   bash backend/scripts/staging-migrate.sh check                                   connects READ-ONLY and reports whether the target is ready.
#   bash backend/scripts/staging-migrate.sh apply --confirm-project <project id | Neon endpoint id> --data-api-is-off [--target-is-neon-staging-branch]
#                                                                                   makes the changes (you also have to type STAGING).
#       --target-is-neon-staging-branch is required for Neon only: your promise that the connection belongs to the branch you created for
#       staging, never the project's default branch.
#
# Connection details are read from backend/database/.env.staging (git-ignored by the ".env.*" rule). It is read as PLAIN DATA,
# never run as code, and only these keys are accepted:
#   STAGING_PROVIDER (supabase | neon, default supabase)  STAGING_PROJECT_REF  STAGING_DB_HOST  STAGING_DB_PORT  STAGING_DB_NAME
#   STAGING_DB_USER  STAGING_DB_PASSWORD  STAGING_CA_FILE (known key, but REFUSED if present: see PINNED TARGET below)
# What each provider must look like (anything else is refused):
#   supabase  ref = 20-character project id; host *.supabase.com|co; port 5432; database postgres; user postgres.<ref>
#             (or user postgres with host db.<ref>.supabase.co). Session pooler or direct; the Transaction pooler (6543) is refused.
#   neon      ref = the compute ENDPOINT id (ep-...) that starts the host name; host <ref>.<region>.(aws|azure).neon.tech, the DIRECT host
#             (a "-pooler" host is refused); port 5432; database neondb; user neondb_owner. The server's identity is always verified (verify-full).
# Values may only contain letters, digits and _ . - : /   so use a database password made of letters and digits (and _) only.
#
# PINNED TARGET (production safety guard). This copy of the script is approved for ONE database only: the Neon STAGING branch whose
# compute endpoint is ep-square-tooth-za49d9tq (host ep-square-tooth-za49d9tq.c-2.eu-west-2.aws.neon.tech). It always refuses the
# production endpoint ep-broad-surf-zak5gkyg (in any setting, in any letter case), refuses Supabase, and has no default provider or
# target: a setting that is missing, different or taken from the shell is a refusal, never a fallback. The guard (guard_approved_target)
# runs in plan (when .env.staging exists), check and apply, before Docker is even looked at, and again just before apply changes anything.
# The guard also requires STAGING_DB_PASSWORD (present, at least 16 characters, never shown), refuses STAGING_CA_FILE (the server is
# verified with the normal system certificate authorities, TLS verify-full), and check/apply refuse RPSQL_OPTIONS set in the shell.
# The Supabase code below is kept but cannot be reached.
#
# The password never appears on a command line, in the output or in a log: it is handed to the throw-away psql container as an
# environment variable (docker run -e NAME copies it from this shell without printing it). No tool is installed: psql comes
# from the postgres:17-alpine image that is already on this computer (--pull=never, so nothing is downloaded).
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"      # die, load_env_file, need_docker, ROOT. The development guard_dev is deliberately NOT used here.

STAGING_ENV_FILE="$ROOT/database/.env.staging"
STAGING_KEYS="STAGING_PROVIDER STAGING_PROJECT_REF STAGING_DB_HOST STAGING_DB_PORT STAGING_DB_NAME STAGING_DB_USER STAGING_DB_PASSWORD STAGING_CA_FILE"
PROVIDER=supabase                        # set from STAGING_PROVIDER by load_staging
LABEL="staging"                          # fixed on purpose: no option, no variable, no way to ask for 'production' here
PSQL_IMAGE="postgres:17-alpine"

# The ONE approved target, and the ONE forbidden one. Changing these is a deliberate edit of this file, never a setting.
APPROVED_PROVIDER="neon"
APPROVED_NEON_ENDPOINT="ep-square-tooth-za49d9tq"                                   # the Neon branch 'staging'
APPROVED_NEON_HOST="ep-square-tooth-za49d9tq.c-2.eu-west-2.aws.neon.tech"           # its DIRECT (non-pooled) host
FORBIDDEN_NEON_ENDPOINT="ep-broad-surf-zak5gkyg"                                    # the PRODUCTION compute: never acceptable

usage() { sed -n '3,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ---- the migrations (same files, same order, same checksums as the development database) ------------------------------
migrations() { ls "$ROOT"/database/migrations/*.sql; }
checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }

# ---- settings and guards --------------------------------------------------------------------------------------------
refuse_ambient_connection_settings() {
  local v
  for v in DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSSLMODE PGSSLROOTCERT PGOPTIONS RPSQL_OPTIONS; do
    [ -z "${!v:-}" ] || die "$v is set in your shell. Unset it: this script takes its connection ONLY from database/.env.staging."
  done
}

# Does this text contain the production endpoint id, in any capitalisation? Used on every setting.
mentions_forbidden() {
  local low; low="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$low" in *"$FORBIDDEN_NEON_ENDPOINT"*) return 0;; esac
  return 1
}

# The staging settings come ONLY from the file. A STAGING_* value already present in the shell could silently fill a gap in the file
# (a fallback), so it is refused.
refuse_ambient_staging_settings() {
  local k
  for k in $STAGING_KEYS; do
    [ -z "${!k:-}" ] || die "$k is set in your shell. Unset it: the staging settings come ONLY from database/.env.staging (nothing is filled in from anywhere else)."
  done
}

# Reads backend/database/.env.staging as plain data (never run as code). Needs no Docker and makes no connection. Never prints the password.
read_staging_settings() {
  refuse_ambient_staging_settings
  [ -f "$STAGING_ENV_FILE" ] || die "backend/database/.env.staging is missing. Nothing has been created for you; see the instructions you were given."
  load_env_file "$STAGING_ENV_FILE" $STAGING_KEYS
}

# THE PRODUCTION SAFETY GUARD. Pure checks on the settings already read: no Docker, no network, no database. Stops (die) on the first problem.
guard_approved_target() {
  local k v
  # 1. The production endpoint may not appear in ANY setting, in any form (id, host, pooled host, user, ...). The value is never printed.
  for k in $STAGING_KEYS; do
    v="${!k:-}"
    if mentions_forbidden "$v"; then
      die "REFUSED: $k names the PRODUCTION endpoint ($FORBIDDEN_NEON_ENDPOINT). This script never touches production."
    fi
  done
  # 2. Exactly the approved staging target, nothing else. There is no default: a missing setting is a refusal.
  [ -n "${STAGING_PROVIDER:-}" ]                          || die "REFUSED: STAGING_PROVIDER is not set. It must be '$APPROVED_PROVIDER'; there is no default."
  [ "$STAGING_PROVIDER" != "supabase" ]                   || die "REFUSED: this script is approved for the Neon staging endpoint only. Supabase is refused."
  [ "$STAGING_PROVIDER" = "$APPROVED_PROVIDER" ]          || die "REFUSED: STAGING_PROVIDER must be exactly '$APPROVED_PROVIDER'."
  [ "${STAGING_PROJECT_REF:-}" = "$APPROVED_NEON_ENDPOINT" ] || die "REFUSED: STAGING_PROJECT_REF is not the approved staging endpoint ($APPROVED_NEON_ENDPOINT)."
  [ "${STAGING_DB_HOST:-}" = "$APPROVED_NEON_HOST" ]      || die "REFUSED: STAGING_DB_HOST is not the approved staging host ($APPROVED_NEON_HOST)."
  [ "${STAGING_DB_PORT:-}" = "5432" ]                     || die "REFUSED: STAGING_DB_PORT must be 5432."
  [ "${STAGING_DB_NAME:-}" = "neondb" ]                   || die "REFUSED: STAGING_DB_NAME must be neondb."
  [ "${STAGING_DB_USER:-}" = "neondb_owner" ]             || die "REFUSED: STAGING_DB_USER must be neondb_owner."
  # 3. The password: it must exist and be long enough. Only its presence and length are tested; the value is never printed or logged.
  [ -n "${STAGING_DB_PASSWORD:-}" ]                       || die "REFUSED: STAGING_DB_PASSWORD is missing (or empty) in .env.staging."
  [ "${#STAGING_DB_PASSWORD}" -ge 16 ]                    || die "REFUSED: STAGING_DB_PASSWORD is shorter than 16 characters (the password is not shown)."
  # 4. No custom certificate authority file. The server is verified with the normal system certificate authorities (TLS verify-full).
  [ -z "${STAGING_CA_FILE+set}" ]                         || die "REFUSED: STAGING_CA_FILE must not be set for the approved Neon staging setup. Remove the line; the normal system certificate authorities are used."
}

load_staging() {
  refuse_ambient_connection_settings
  read_staging_settings
  guard_approved_target                                  # BEFORE Docker is even looked at: a wrong target stops here
  need_docker                                            # the local Docker Desktop engine only (same guard as every other script)
  docker image inspect "$PSQL_IMAGE" >/dev/null 2>&1 || die "The image $PSQL_IMAGE is not on this computer (this script never downloads anything)."
  PROVIDER="$STAGING_PROVIDER"                           # always 'neon' here: the guard above has refused everything else
  case "$PROVIDER" in supabase|neon) ;; *) die "STAGING_PROVIDER must be 'neon'.";; esac
  local ref="${STAGING_PROJECT_REF:-}" host="${STAGING_DB_HOST:-}" user="${STAGING_DB_USER:-}"
  if [ "$PROVIDER" = supabase ]; then
    [[ "$ref" =~ ^[a-z0-9]{20}$ ]]                          || die "STAGING_PROJECT_REF must be the 20-character project id."
    [[ "$host" =~ ^[a-z0-9.-]+\.supabase\.(com|co)$ ]]      || die "STAGING_DB_HOST must be a Supabase host (…supabase.com or …supabase.co). Anything else is refused."
    [ "${STAGING_DB_PORT:-}" = "5432" ]                     || die "STAGING_DB_PORT must be 5432 (direct or Session pooler). The Transaction pooler (6543) is refused."
    [ "${STAGING_DB_NAME:-}" = "postgres" ]                 || die "STAGING_DB_NAME must be 'postgres' (the project's own database)."
    { [ "$user" = "postgres.$ref" ] || { [ "$user" = "postgres" ] && [ "$host" = "db.$ref.supabase.co" ]; }; } \
                                                            || die "The user/host do not belong to project $ref. Refusing: this could be a different project."
  else
    # Neon. The endpoint id (ep-...) names ONE compute, i.e. one branch. It must be the first part of the host, so the host, the id you
    # repeat on the command line and the branch you meant are one and the same thing.
    [[ "$ref" =~ ^ep-[a-z0-9]+(-[a-z0-9]+)+$ ]]             || die "For Neon, STAGING_PROJECT_REF must be the compute endpoint id (it starts with ep- and is the first part of the host name)."
    [[ "$host" != *-pooler* ]]                              || die "STAGING_DB_HOST is a pooled Neon host (-pooler). Migrations must use the DIRECT host: turn Connection pooling off when copying the connection details."
    [[ "$host" =~ ^"$ref"\.[a-z0-9.-]+\.(aws|azure)\.neon\.tech$ ]] \
                                                            || die "STAGING_DB_HOST must be exactly <endpoint id>.<region>.aws.neon.tech (or .azure.neon.tech) and start with STAGING_PROJECT_REF. Anything else is refused."
    [ "${STAGING_DB_PORT:-}" = "5432" ]                     || die "STAGING_DB_PORT must be 5432 for Neon."
    [ "${STAGING_DB_NAME:-}" = "neondb" ]                   || die "STAGING_DB_NAME must be 'neondb' (the project's default database)."
    [ "$user" = "neondb_owner" ]                            || die "STAGING_DB_USER must be 'neondb_owner' (the database owner Neon creates)."
  fi
  [ "${#STAGING_DB_PASSWORD}" -ge 16 ]                    || die "STAGING_DB_PASSWORD is missing or shorter than 16 characters."
  if [ -n "${STAGING_CA_FILE:-}" ]; then [ -f "$STAGING_CA_FILE" ] || die "STAGING_CA_FILE does not exist."; fi
}

# psql in a throw-away container against the staging database. Stdin is passed through (-i) so SQL can be piped in.
rpsql() {
  local mount=() certenv=() stdin=(-i) ssl=require rootcert="" timeout=15
  case " $* " in *" -c "*) stdin=();; esac    # a one-line -c command never reads stdin, so do not attach it (it could swallow what you type)
  if [ "$PROVIDER" = neon ]; then             # Neon: always verify who answers, using the public certificate authorities built into the image;
    ssl=verify-full; rootcert=system; certenv=(-e PGSSLROOTCERT)
    timeout=30                                # a Neon compute that has gone to sleep needs a moment to wake up on the first connection
  fi
  if [ -n "${STAGING_CA_FILE:-}" ]; then      # with the project's CA file the server's identity is verified too (strongly advised)
    ssl=verify-full; rootcert=/ca.crt; certenv=(-e PGSSLROOTCERT)
    mount=(-v "$(cygpath -m "$STAGING_CA_FILE" 2>/dev/null || echo "$STAGING_CA_FILE"):/ca.crt:ro")
  fi
  PGHOST="$STAGING_DB_HOST" PGPORT="$STAGING_DB_PORT" PGDATABASE="$STAGING_DB_NAME" PGUSER="$STAGING_DB_USER" PGPASSWORD="$STAGING_DB_PASSWORD" \
  PGSSLMODE="$ssl" PGSSLROOTCERT="$rootcert" PGCONNECT_TIMEOUT="$timeout" PGAPPNAME=newscafe-staging-migrate PGOPTIONS="${RPSQL_OPTIONS:-}" \
  MSYS_NO_PATHCONV=1 docker run --rm "${stdin[@]}" --pull=never "${mount[@]}" \
    -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE "${certenv[@]}" -e PGCONNECT_TIMEOUT -e PGAPPNAME -e PGOPTIONS \
    "$PSQL_IMAGE" psql -X -q -v ON_ERROR_STOP=1 "$@"
}
rpsql_ro() { RPSQL_OPTIONS="-c default_transaction_read_only=on" rpsql "$@"; }     # the server itself refuses any write on this connection

# ---- read-only inspection ---------------------------------------------------------------------------------------------
facts() {
  rpsql_ro -tA -F= <<'SQL'
SELECT 'server_major', (current_setting('server_version_num')::int / 10000)::text
UNION ALL SELECT 'can_create_roles', (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = current_user)::text
UNION ALL SELECT 'is_superuser', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
UNION ALL SELECT 'extensions_available', count(*)::text FROM pg_available_extensions WHERE name IN ('btree_gist', 'citext')
UNION ALL SELECT 'public_tables', count(*)::text FROM pg_tables WHERE schemaname = 'public'
UNION ALL SELECT 'has_schema_migrations', (to_regclass('public.schema_migrations') IS NOT NULL)::text
UNION ALL SELECT 'has_app_environment', (to_regclass('public.app_environment') IS NOT NULL)::text
UNION ALL SELECT 'newscafe_roles', count(*)::text FROM pg_roles WHERE rolname LIKE 'newscafe\_%'
UNION ALL SELECT 'data_api_roles', count(*)::text FROM pg_roles WHERE rolname IN ('anon', 'anonymous', 'authenticated', 'service_role')
UNION ALL SELECT 'authenticator_role', (to_regrole('authenticator') IS NOT NULL)::text
UNION ALL SELECT 'extensions_elsewhere', count(*)::text FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                                          WHERE e.extname IN ('btree_gist', 'citext') AND n.nspname <> 'public'
UNION ALL SELECT 'can_grant_create_on_public', (SELECT pg_has_role(current_user, n.nspowner, 'USAGE')
                                                   OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
                                                               WHERE a.privilege_type = 'CREATE' AND a.is_grantable AND a.grantee <> 0 AND pg_has_role(current_user, a.grantee, 'USAGE'))
                                                  FROM pg_namespace n WHERE n.nspname = 'public')::text;
SQL
}
fact() { printf '%s\n' "$FACTS" | sed -n "s/^$1=//p"; }

assess() {                                   # sets READY=yes|no and prints every reason
  READY=yes; FACTS="$(facts)"
  echo "  provider: $PROVIDER   server: PostgreSQL $(fact server_major)   user may create roles: $(fact can_create_roles)   superuser: $(fact is_superuser)"
  echo "  tables already in schema public: $(fact public_tables)   newscafe_* roles already present: $(fact newscafe_roles)"
  local why=()
  [ "$(fact server_major)" = "17" ]           || why+=("server is not PostgreSQL 17 (the development database is 17)")
  [ "$(fact can_create_roles)" = "true" ]        || why+=("the login cannot create roles (migration 0008 needs it)")
  [ "$(fact extensions_available)" = "2" ]    || why+=("btree_gist and/or citext are not available (migration 0001 needs both)")
  [ "$(fact extensions_elsewhere)" = "0" ]    || why+=("btree_gist or citext is already installed outside schema public; the migrations expect them in public")
  [ "$(fact can_grant_create_on_public)" = "true" ] || why+=("the login cannot grant CREATE on schema public; migration 0009 (ALTER FUNCTION ... OWNER TO newscafe_definer) needs that to be possible")
  # Neon: the optional Neon Data API (a web API in front of the database) creates a role called "authenticator". Its presence means the API may be
  # switched on, which this practice database must not have. (Supabase always has this role, so the test is for Neon only.)
  if [ "$PROVIDER" = neon ] && [ "$(fact authenticator_role)" = "true" ]; then
    why+=("this Neon database has an 'authenticator' role, which suggests the Neon Data API is enabled. Turn it off (and remove the role) first")
  fi
  if [ "$(fact has_app_environment)" = "true" ]; then
    local have; have="$(rpsql_ro -tA -c 'SELECT env FROM app_environment')"
    echo "  environment label already in the database: $have"
    [ "$have" = "$LABEL" ] || why+=("the database is already labelled '$have', not '$LABEL'")
  fi
  if [ "$(fact has_schema_migrations)" != "true" ] && [ "$(fact public_tables)" != "0" ]; then
    why+=("schema public already holds tables that did not come from these migrations: refusing to build on top of unknown content")
  fi
  if [ "${#why[@]}" -gt 0 ]; then READY=no; local w; for w in "${why[@]}"; do echo "  NOT READY: $w"; done; else echo "  READY: the target is empty (or a partly finished earlier run of this script) and meets every requirement."; fi
}

# ---- the changes ------------------------------------------------------------------------------------------------------
# Supabase publishes the "public" schema through a web API (the "Data API") for its anon / authenticated / service_role roles. News Cafe
# does not use that API and its security does not depend on it, so (1) the owner turns the Data API off in the dashboard (--data-api-is-off
# is a promise that this was done) and (2) this script also stops new tables, sequences and functions from ever being granted to those
# roles, and sweeps any existing grant away afterwards. Both are safe to repeat.
close_data_api_defaults() {
  rpsql -f - <<'SQL'
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'anonymous', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
SQL
}
sweep_data_api_grants() {
  rpsql -f - <<'SQL'
SET client_min_messages = error;      -- the extension's helper functions would otherwise print one harmless warning each
DO $$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'anonymous', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      -- Only functions the login owns can be changed by it. (Rehearsal finding: after migration 0009 the News Cafe functions belong to
      -- newscafe_definer, and "REVOKE ... ON ALL FUNCTIONS" would stop with "permission denied". They never received a grant to these
      -- roles anyway, because close_data_api_defaults ran first; verify() below proves it.)
      FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
SQL
}

# Migration 0009 changes function owners to newscafe_definer and then GRANTs EXECUTE on those functions. On a hosted database the login is NOT
# a superuser, and (PostgreSQL 16+) a role's creator may administer it but may neither act as it nor use its rights unless it grants itself
# that. Rehearsal finding: SET alone is not enough, because after the owner change the login can only GRANT on those functions if it also
# INHERITs the definer's rights. So both are granted for the duration of the migrations and withdrawn again by withdraw_definer_create.
ensure_definer_membership() {
  rpsql -f - <<'SQL'
DO $$
BEGIN
  IF to_regrole('newscafe_definer') IS NOT NULL
     AND NOT (pg_has_role(current_user, 'newscafe_definer', 'SET') AND pg_has_role(current_user, 'newscafe_definer', 'USAGE')) THEN
    EXECUTE format('GRANT newscafe_definer TO %I WITH SET TRUE, INHERIT TRUE', current_user);
  END IF;
  -- ALTER FUNCTION ... OWNER TO also needs the NEW owner to hold CREATE on the schema. (The development database ran this as a superuser, which
  -- skips that rule.) It is granted only for the duration of the migrations and taken away again by withdraw_definer_create below.
  IF to_regrole('newscafe_definer') IS NOT NULL THEN
    GRANT CREATE ON SCHEMA public TO newscafe_definer;
  END IF;
END $$;
SQL
}

# Takes back the two temporary rights (CREATE on the schema for newscafe_definer, and the login's own membership of that role) once every
# function belongs to newscafe_definer, so the final state matches the development database. Safe to repeat. The login keeps the
# administrator membership PostgreSQL gave it when it created the role.
withdraw_definer_create() {
  rpsql -f - <<'SQL'
DO $$
BEGIN
  IF to_regrole('newscafe_definer') IS NOT NULL THEN        -- nothing to withdraw if the roles were never created
    REVOKE CREATE ON SCHEMA public FROM newscafe_definer;
    EXECUTE format('REVOKE newscafe_definer FROM %I', current_user);   -- removes only the grant made in ensure_definer_membership
  END IF;
END $$;
SQL
}

apply_migrations() {
  local f ver sum prev
  rpsql -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
  for f in $(migrations); do
    ver="$(basename "$f")"; sum="$(checksum "$f")"
    prev="$(rpsql -tA -c "SELECT checksum FROM schema_migrations WHERE version='$ver'")"
    if [ -n "$prev" ]; then
      [ "$prev" = "$sum" ] || die "Migration $ver in the database differs from the file on this computer. Stopping; never edit an applied migration."
      echo "  $ver already applied"
    else
      echo "  applying $ver"
      # the migration and its bookkeeping row succeed or fail together
      { cat "$f"; printf "\nINSERT INTO schema_migrations (version, checksum) VALUES ('%s', '%s');\n" "$ver" "$sum"; } | rpsql --single-transaction -f -
      # the locked environment label goes in immediately after the table that holds it exists: 'staging', fixed in this script
      if [ "$ver" = "0001_extensions_environment.sql" ]; then rpsql -c "INSERT INTO app_environment (env) VALUES ('$LABEL') ON CONFLICT DO NOTHING"; fi
    fi
    if [ "$ver" = "0008_api_roles.sql" ]; then ensure_definer_membership; fi        # before 0009 needs it, whether 0008 ran now or earlier
  done
}

verify() {                                    # read-only; any failed check stops the script with an error
  echo "  structure and safety checks (nothing is changed):"
  rpsql_ro -f - <<SQL
\set ON_ERROR_STOP on
DO \$\$
DECLARE n integer; bad text; r text;
BEGIN
  IF app_env() <> '$LABEL' THEN RAISE EXCEPTION 'CHECK FAILED: environment label is %', app_env(); END IF;
  RAISE NOTICE 'ok - environment label is $LABEL (locked)';
  SELECT count(*) INTO n FROM schema_migrations;
  IF n <> $(migrations | wc -l | tr -d ' ') THEN RAISE EXCEPTION 'CHECK FAILED: % migrations recorded', n; END IF;
  RAISE NOTICE 'ok - % migrations recorded', n;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_allocations_no_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION 'CHECK FAILED: the double-booking protection (overlap constraint) is missing'; END IF;
  RAISE NOTICE 'ok - double-booking protection is present';
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace AND p.proowner <> 'newscafe_definer'::regrole) THEN
    RAISE EXCEPTION 'CHECK FAILED: a SECURITY DEFINER function is not owned by newscafe_definer'; END IF;
  IF has_table_privilege('newscafe_public', 'reservations', 'SELECT') OR has_table_privilege('newscafe_admin', 'reservations', 'UPDATE')
     OR NOT has_function_privilege('newscafe_public', 'public_available_slots(date, integer)', 'EXECUTE')
     OR has_function_privilege('newscafe_public', 'book_reservation(uuid, integer, timestamptz, text, text, text, text, text, boolean, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CHECK FAILED: API role privileges are not as designed'; END IF;
  IF has_schema_privilege('newscafe_definer', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'CHECK FAILED: newscafe_definer still has CREATE on schema public (it is only meant to hold it while the migrations run)'; END IF;
  IF pg_has_role(current_user, 'newscafe_definer', 'SET') OR pg_has_role(current_user, 'newscafe_definer', 'USAGE') THEN
    RAISE EXCEPTION 'CHECK FAILED: the login still acts as / inherits newscafe_definer (that membership is only meant to last while the migrations run)'; END IF;
  RAISE NOTICE 'ok - definer-owned functions, closed API privileges, no leftover CREATE right, no leftover membership';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'newscafe\_%' AND rolcanlogin) THEN
    RAISE EXCEPTION 'CHECK FAILED: a newscafe_* role can log in (they must stay NOLOGIN, without passwords, until separately approved)'; END IF;
  RAISE NOTICE 'ok - the three newscafe_* roles cannot log in and have no passwords';
  -- Data API roles must hold no privilege on anything in public
  FOREACH r IN ARRAY ARRAY['anon', 'anonymous', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
      IF bad IS NOT NULL THEN RAISE EXCEPTION 'CHECK FAILED: % can reach: %', r, bad; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok - the Data API roles (Supabase: anon, authenticated, service_role; Neon: anonymous) have no access to any News Cafe table';
  -- no News Cafe function may carry an explicit grant to a Data API role
  SELECT string_agg(p.proname || ' -> ' || g.rolname, ', ') INTO bad
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a JOIN pg_roles g ON g.oid = a.grantee
   WHERE p.pronamespace = 'public'::regnamespace AND g.rolname IN ('anon', 'anonymous', 'authenticated', 'service_role')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'CHECK FAILED: News Cafe functions are granted to the Data API roles: %', bad; END IF;
  RAISE NOTICE 'ok - no News Cafe function is granted to a Data API role';
  SELECT count(*) INTO n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
     AND to_regrole('anon') IS NOT NULL AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF n > 0 THEN RAISE NOTICE 'note - % News Cafe helper function(s) can still be executed by anon through the default PUBLIC grant (no table access). That is why the Data API must stay OFF.', n; END IF;
  -- no data of any kind: every table except the two bookkeeping tables and the one settings row must be empty
  SELECT string_agg(t || '=' || c, ', ') INTO bad FROM (
    SELECT tablename AS t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int AS c
    FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'app_environment', 'menu_settings')) x WHERE c > 0;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'CHECK FAILED: tables contain rows: %', bad; END IF;
  RAISE NOTICE 'ok - no data: every table is empty (menu_settings holds the single default settings row the migrations create)';
END \$\$;
SQL
}

# ---- modes ------------------------------------------------------------------------------------------------------------
mode="${1:-}"; [ "$#" -gt 0 ] && shift || true
case "$mode" in
  plan)
    echo "PLAN (offline: no connection is made and nothing is changed. If backend/database/.env.staging exists it IS read, as plain data, to check the target; the password is never shown)"
    if [ -f "$STAGING_ENV_FILE" ]; then
      read_staging_settings; guard_approved_target
      echo "  TARGET CHECK: OK. backend/database/.env.staging names the approved Neon staging endpoint $APPROVED_NEON_ENDPOINT and holds a password of acceptable length (not shown). Nothing was connected to: whether the password is right and the database is ready is NOT checked here ('check' does that)."
    else
      echo "  TARGET NOT CHECKED: backend/database/.env.staging does not exist, so this plan cannot say which database it would use. 'check' and 'apply' refuse to run without it."
    fi
    echo "  Target: ONLY the approved Neon staging endpoint $APPROVED_NEON_ENDPOINT. The production endpoint $FORBIDDEN_NEON_ENDPOINT and Supabase are always refused."
    echo "  Label that will be stored, permanently: $LABEL"
    echo "  Migrations that would be applied, in this order, each in its own transaction:"
    for f in $(migrations); do printf '    %s  sha256 %s\n' "$(basename "$f")" "$(checksum "$f" | cut -c1-16)"; done
    echo "  Before the first table: stop the provider's API roles (Supabase: anon, authenticated, service_role) from receiving grants. After 0008: let the login act as (and inherit) newscafe_definer and give"
    echo "  that role CREATE on schema public (both needed by 0009's ALTER FUNCTION ... OWNER TO and GRANTs). Both temporary rights are withdrawn after the"
    echo "  last migration, and also automatically if anything stops the script part-way. Re-running apply resumes after the migrations already done."
    echo "  After the last migration: sweep grants, then run the read-only checks. NEVER run: dev_seed.sql, any seed, any owner creation, any role password."
    ;;
  check)
    echo "CHECK (read-only: the server refuses any write on this connection)"
    load_staging; echo "  provider: $PROVIDER   target host: $STAGING_DB_HOST   project/endpoint: $STAGING_PROJECT_REF   (password not shown)"
    assess
    [ "$READY" = yes ] || exit 1
    ;;
  apply)
    confirm="" api_off=no neon_branch=no
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --confirm-project) confirm="${2:-}"; shift 2;;
        --data-api-is-off) api_off=yes; shift;;
        --target-is-neon-staging-branch) neon_branch=yes; shift;;
        *) usage 1;;
      esac
    done
    # The typed endpoint id is checked first: it needs no settings, no Docker and no connection.
    if mentions_forbidden "$confirm"; then die "REFUSED: --confirm-project names the PRODUCTION endpoint ($FORBIDDEN_NEON_ENDPOINT). This script never touches production."; fi
    [ "$confirm" = "$APPROVED_NEON_ENDPOINT" ] || die "--confirm-project must be the approved staging endpoint id ($APPROVED_NEON_ENDPOINT), typed exactly."
    load_staging
    [ "$api_off" = yes ] || die "Turn the provider's Data API off first (Supabase dashboard; Neon: make sure the Data API is not enabled), then add --data-api-is-off."
    if [ "$PROVIDER" = neon ]; then
      [ "$neon_branch" = yes ] || die "For Neon, add --target-is-neon-staging-branch: it is your promise that this connection belongs to the branch you created for staging, not the default branch."
    else
      [ "$neon_branch" = no ] || die "--target-is-neon-staging-branch only applies when STAGING_PROVIDER=neon."
    fi
    [ -t 0 ] || die "apply needs a person at the keyboard (it asks you to type a word). It will not run unattended."
    echo "APPLY ($PROVIDER) to project/endpoint $STAGING_PROJECT_REF on $STAGING_DB_HOST"
    assess
    [ "$READY" = yes ] || die "Not ready. Nothing was changed."
    echo; echo "This will create the News Cafe structure in that database and label it '$LABEL' for ever. No data is loaded."
    read -r -p "Type STAGING to continue: " answer
    [ "$answer" = "STAGING" ] || die "Not confirmed. Nothing was changed."
    guard_approved_target                                # one last look at the target, immediately before anything is changed
    # Rehearsal finding: if a migration fails part-way, the two temporary rights would otherwise stay in place until the next successful run.
    # Whatever stops the script from here on, take them back. (The migrations already applied stay: each one is complete and recorded, and
    # running apply again resumes after them. A failed migration itself has rolled back as a whole.)
    trap 'rc=$?; trap - EXIT; if [ "$rc" -ne 0 ]; then echo "  STOPPED (exit $rc). Taking back the temporary rights; the database is otherwise left as it is. Fix the cause and run apply again to resume." >&2; withdraw_definer_create || echo "  WARNING: could not take them back. Running apply again will finish the job and take them back." >&2; fi; exit "$rc"' EXIT
    echo "  1. closing the provider's Data API roles (Supabase: anon, authenticated, service_role; Neon: anonymous) to new objects"; close_data_api_defaults
    echo "  2. migrations";                                            apply_migrations
    echo "  3. withdrawing the temporary CREATE right";                withdraw_definer_create
    echo "  4. sweeping any Data API grants";                          sweep_data_api_grants
    echo "  5. checks";                                                verify
    echo "DONE. The database has the structure only. The newscafe_* roles still cannot log in; no owner account, password or data exists."
    ;;
  *) usage 1;;
esac
