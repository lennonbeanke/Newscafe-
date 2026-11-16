#!/usr/bin/env bash
# Proves the PRODUCTION SAFETY GUARD of backend/scripts/staging-migrate.sh: only the approved Neon staging endpoint is accepted, the production
# endpoint and everything else is refused, in plan, check and apply, and a refusal happens BEFORE Docker is touched.
# FULLY OFFLINE: it uses fake settings in a throw-away copy of the folders and a FAKE `docker` command that only writes down what it was
# asked and refuses real work. No Neon connection, no Docker engine, no database, no migration.
# It never reads or writes backend/database/.env.staging (the script under test runs in the throw-away copy).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_SRC="$HERE/../../scripts/staging-migrate.sh"
COMMON_SRC="$HERE/../../scripts/lib/common.sh"
MIGRATIONS_SRC="$HERE/../migrations"

STAGING_EP=ep-square-tooth-za49d9tq
STAGING_HOST=$STAGING_EP.c-2.eu-west-2.aws.neon.tech
PROD_EP=ep-broad-surf-zak5gkyg
FAKE_PW=FakePasswordForTest0123456789        # obviously fake; the test also proves it is never printed
SHORT_PW=Abcdefghij01234                     # fake, 15 characters: one too short
PW16=Abcdefghij012345                        # fake, exactly 16 characters: the shortest accepted

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASSES=0; FAILS=0
ok()  { echo "ok - $1"; PASSES=$((PASSES+1)); }
bad() { echo "FAILED - $1"; FAILS=$((FAILS+1)); }

# ---- a throw-away copy of the folders the script needs, with a fake docker -------------------------------------------------------
R="$T/repo"; mkdir -p "$R/backend/scripts/lib" "$R/backend/database/migrations" "$R/scripts/lib" "$T/bin"
cp "$SCRIPT_SRC" "$R/backend/scripts/staging-migrate.sh"          # the REAL script text under test
cp "$COMMON_SRC" "$R/backend/scripts/lib/common.sh"                # the real helpers (die, load_env_file)
cp "$MIGRATIONS_SRC"/*.sql "$R/backend/database/migrations/"
# The repo's docker guard is replaced by a stub that only asks the fake docker (the real need_docker is tested by 40_script_guards.sh).
cat > "$R/scripts/lib/docker-guard.sh" <<'STUB'
die() { echo "ERROR: $*" >&2; exit 1; }
need_docker() { docker info >/dev/null 2>&1 || die "fake docker refused"; }
STUB
# The fake docker: writes down every call; answers 'info' and 'image inspect' (so the script can go on); REFUSES anything else, 'run' included.
DOCKER_LOG="$T/docker-calls.log"; DOCKER_ALL="$T/docker-all.log"; : > "$DOCKER_ALL"
cat > "$T/bin/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$DOCKER_LOG"; echo "\$*" >> "$DOCKER_ALL"
case "\$1" in info|image) exit 0;; *) echo "fake docker: refused '\$1'" >&2; exit 1;; esac
STUB
chmod +x "$T/bin/docker"
SCRIPT="$R/backend/scripts/staging-migrate.sh"; ENVF="$R/backend/database/.env.staging"
[ "$(PATH="$T/bin:$PATH" command -v docker)" = "$T/bin/docker" ] || { echo "FAILED - the fake docker is not the one found first on PATH"; exit 1; }

# ---- helpers ---------------------------------------------------------------------------------------------------------------------
good() { # the one valid settings set
  printf '%s\n' "STAGING_PROVIDER=neon" "STAGING_PROJECT_REF=$STAGING_EP" "STAGING_DB_HOST=$STAGING_HOST" "STAGING_DB_PORT=5432" \
    "STAGING_DB_NAME=neondb" "STAGING_DB_USER=neondb_owner" "STAGING_DB_PASSWORD=$FAKE_PW"
}
with()    { good | sed "s#^$1=.*#$1=$2#"; }                  # the valid set with ONE value replaced
without() { good | grep -v "^$1=" || true; }                 # the valid set with ONE key missing

OUT=""; RC=0
run_script() { # args = script arguments; settings already in $ENVF
  : > "$DOCKER_LOG"
  RC=0; OUT="$(cd "$T" && env -i PATH="$T/bin:$PATH" HOME="$T" TEMP="$T" TMP="$T" bash "$SCRIPT" "$@" 2>&1 </dev/null)" || RC=$?
}
run_with_shell_value() { # NAME VALUE, then script args: the same, with one variable set in the shell
  local n="$1" v="$2"; shift 2; : > "$DOCKER_LOG"
  RC=0; OUT="$(cd "$T" && env -i PATH="$T/bin:$PATH" HOME="$T" TEMP="$T" TMP="$T" "$n=$v" bash "$SCRIPT" "$@" 2>&1 </dev/null)" || RC=$?
}
docker_calls() { wc -l < "$DOCKER_LOG" | tr -d ' '; }
docker_runs()  { grep -c '^run' "$DOCKER_LOG" || true; }
no_secret()    { local s; for s in "$FAKE_PW" "$SHORT_PW" "$PW16"; do [ "$(printf '%s' "$OUT" | grep -c -- "$s" || true)" = 0 ] || return 1; done; }   # none of the fake passwords appears in the output
APPLY_ARGS=(apply --confirm-project "$STAGING_EP" --data-api-is-off --target-is-neon-staging-branch)

# refused DESC WHY ARGS...: exit non-zero, the message contains WHY, Docker was NEVER called, the password is not printed.
refused() {
  local desc="$1" why="$2"; shift 2
  run_script "$@"
  if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ] && no_secret && printf '%s' "$OUT" | grep -q -- "$why"; then ok "$desc"
  else bad "$desc (exit $RC, docker calls $(docker_calls), output: $(printf '%s' "$OUT" | head -2 | cut -c1-160))"; fi
}
# refused_everywhere DESC WHY: the settings already written to $ENVF must be refused in plan, check and apply.
refused_everywhere() {
  refused "plan:  $1"  "$2" plan
  refused "check: $1"  "$2" check
  refused "apply: $1"  "$2" "${APPLY_ARGS[@]}"
}

echo "== 1  the approved staging settings are ACCEPTED (the guard lets them through)"
good > "$ENVF"
run_script plan
if [ "$RC" -eq 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "TARGET CHECK: OK" && no_secret; then ok "plan: exits 0, says TARGET CHECK: OK, uses no Docker, prints no password"
else bad "plan with the staging settings (exit $RC): $OUT"; fi
run_script check
ACCEPT_RUNS="$(docker_runs)"
# The guard passes, so the script goes on: it asks the fake docker for Docker's state and then to run psql. The FAKE refuses that, so nothing connects.
if ! printf '%s' "$OUT" | grep -q "REFUSED" && [ "$(docker_calls)" -ge 2 ] && [ "$ACCEPT_RUNS" -ge 1 ] && no_secret; then ok "check: passes the guard and goes on to Docker (no REFUSED); the fake docker refuses the connection attempt"
else bad "check with the staging settings (exit $RC, docker: $(head -3 "$DOCKER_LOG" | cut -c1-60 | tr '\n' ';')): $OUT"; fi
run_script "${APPLY_ARGS[@]}"
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "needs a person at the keyboard" && ! printf '%s' "$OUT" | grep -q "REFUSED" && [ "$(docker_runs)" = 0 ] && no_secret; then ok "apply: passes the guard and every flag check, and stops only because nobody is at the keyboard"
else bad "apply with the staging settings (exit $RC): $OUT"; fi

echo; echo "== 2  the PRODUCTION endpoint is refused, in every mode, before Docker"
with STAGING_PROJECT_REF "$PROD_EP" | sed "s#^STAGING_DB_HOST=.*#STAGING_DB_HOST=$PROD_EP.c-2.eu-west-2.aws.neon.tech#" > "$ENVF"; refused_everywhere "production id and production host" "PRODUCTION endpoint"
with STAGING_PROJECT_REF "$PROD_EP" > "$ENVF";                                              refused_everywhere "production id with the staging host" "PRODUCTION endpoint"
with STAGING_DB_HOST "$PROD_EP.c-2.eu-west-2.aws.neon.tech" > "$ENVF";                      refused_everywhere "staging id with the production host" "PRODUCTION endpoint"
with STAGING_DB_HOST "$PROD_EP-pooler.c-2.eu-west-2.aws.neon.tech" > "$ENVF";               refused_everywhere "production POOLED host" "PRODUCTION endpoint"
with STAGING_DB_USER "neondb_owner.$PROD_EP" > "$ENVF";                                     refused_everywhere "production id hidden in the user" "PRODUCTION endpoint"
with STAGING_DB_HOST "$(echo "$PROD_EP" | tr a-z A-Z).C-2.EU-WEST-2.AWS.NEON.TECH" > "$ENVF"; refused_everywhere "production host in capital letters" "PRODUCTION endpoint"
with STAGING_DB_NAME "x$PROD_EP" > "$ENVF";                                                 refused_everywhere "production id inside the database name" "PRODUCTION endpoint"
good > "$ENVF"
refused "apply: --confirm-project is the production id (settings are valid staging)" "PRODUCTION endpoint" apply --confirm-project "$PROD_EP" --data-api-is-off --target-is-neon-staging-branch

echo; echo "== 3  anything else that is not exactly the approved staging target is refused (no fallback)"
without STAGING_PROVIDER > "$ENVF";                                                         refused_everywhere "provider missing (no default)" "STAGING_PROVIDER is not set"
with STAGING_PROVIDER supabase > "$ENVF";                                                   refused_everywhere "provider supabase" "Supabase is refused"
with STAGING_PROVIDER postgres > "$ENVF";                                                   refused_everywhere "unknown provider" "must be exactly 'neon'"
without STAGING_PROJECT_REF > "$ENVF";                                                      refused_everywhere "endpoint id missing" "STAGING_PROJECT_REF"
without STAGING_DB_HOST > "$ENVF";                                                          refused_everywhere "host missing" "STAGING_DB_HOST"
with STAGING_PROJECT_REF ep-other-endpoint-12345678 > "$ENVF";                              refused_everywhere "a different (unknown) endpoint id" "STAGING_PROJECT_REF"
with STAGING_DB_HOST ep-other-endpoint-12345678.c-2.eu-west-2.aws.neon.tech > "$ENVF";      refused_everywhere "a different (unknown) host" "STAGING_DB_HOST"
with STAGING_DB_HOST "$STAGING_EP-pooler.c-2.eu-west-2.aws.neon.tech" > "$ENVF";            refused_everywhere "the staging POOLED host" "STAGING_DB_HOST"
with STAGING_DB_HOST "$STAGING_EP.c-2.us-east-2.aws.neon.tech" > "$ENVF";                   refused_everywhere "right endpoint, wrong region" "STAGING_DB_HOST"
with STAGING_DB_HOST "$STAGING_HOST.evil.example" > "$ENVF";                                refused_everywhere "look-alike host with extra text after neon.tech" "STAGING_DB_HOST"
with STAGING_DB_HOST localhost > "$ENVF";                                                   refused_everywhere "localhost" "STAGING_DB_HOST"
with STAGING_DB_PORT 6543 > "$ENVF";                                                        refused_everywhere "port 6543" "STAGING_DB_PORT"
with STAGING_DB_NAME postgres > "$ENVF";                                                    refused_everywhere "database postgres" "STAGING_DB_NAME"
with STAGING_DB_USER postgres > "$ENVF";                                                    refused_everywhere "user postgres" "STAGING_DB_USER"
good > "$ENVF"
refused "apply: --confirm-project is a different id" "approved staging endpoint id" apply --confirm-project ep-other-endpoint-12345678 --data-api-is-off --target-is-neon-staging-branch
refused "apply: --confirm-project is missing" "approved staging endpoint id" apply --data-api-is-off --target-is-neon-staging-branch

echo; echo "== 4  nothing is filled in from the shell (no fallback to another source)"
without STAGING_DB_HOST > "$ENVF"
for m in plan check; do
  run_with_shell_value STAGING_DB_HOST "$STAGING_HOST" "$m"
  if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "set in your shell"; then ok "$m: STAGING_DB_HOST in the shell cannot fill a gap in the file"; else bad "$m: shell value accepted (exit $RC): $OUT"; fi
done
good > "$ENVF"
run_with_shell_value DATABASE_URL "postgres://x" check
if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ]; then ok "check: an ambient DATABASE_URL is refused before Docker"; else bad "DATABASE_URL accepted"; fi

echo; echo "== 5  plan without .env.staging runs, and says plainly that the target was NOT checked"
rm -f "$ENVF"
run_script plan
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "TARGET NOT CHECKED" && ! printf '%s' "$OUT" | grep -q "TARGET CHECK: OK" && [ "$(docker_calls)" = 0 ]; then ok "plan: exits 0, says TARGET NOT CHECKED, no Docker"
else bad "plan without the file (exit $RC): $OUT"; fi
refused "check without the file: refused before Docker" "missing" check
refused "apply without the file: refused before Docker" "missing" "${APPLY_ARGS[@]}"

echo; echo "== 6  hardening: password rules, no custom CA file, no ambient RPSQL_OPTIONS, corrected plan wording (fake settings only)"
without STAGING_DB_PASSWORD > "$ENVF";            refused_everywhere "password missing" "STAGING_DB_PASSWORD is missing"
with STAGING_DB_PASSWORD "" > "$ENVF";            refused_everywhere "password present but empty" "STAGING_DB_PASSWORD is missing"
with STAGING_DB_PASSWORD "$SHORT_PW" > "$ENVF";   refused_everywhere "password of 15 characters (one too short)" "shorter than 16 characters"
with STAGING_DB_PASSWORD "$PW16" > "$ENVF"
run_script plan
if [ "$RC" -eq 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "TARGET CHECK: OK" && no_secret; then ok "plan: a password of exactly 16 characters is accepted and not printed"
else bad "plan with a 16-character password (exit $RC): $OUT"; fi
run_script "${APPLY_ARGS[@]}"
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "needs a person at the keyboard" && ! printf '%s' "$OUT" | grep -q "REFUSED" && [ "$(docker_runs)" = 0 ] && no_secret; then ok "apply: a password of exactly 16 characters passes the guard and is not printed"
else bad "apply with a 16-character password (exit $RC): $OUT"; fi
: > "$T/fake-ca.crt"
{ good; echo "STAGING_CA_FILE=$T/fake-ca.crt"; } > "$ENVF";     refused_everywhere "STAGING_CA_FILE set to a file that exists" "STAGING_CA_FILE must not be set"
{ good; echo "STAGING_CA_FILE=/nowhere/ca.crt"; } > "$ENVF";     refused_everywhere "STAGING_CA_FILE set to a file that does not exist" "STAGING_CA_FILE must not be set"
{ good; echo "STAGING_CA_FILE="; } > "$ENVF";                    refused_everywhere "STAGING_CA_FILE present but empty" "STAGING_CA_FILE must not be set"
good > "$ENVF"
for v in RPSQL_OPTIONS PGOPTIONS; do
  run_with_shell_value "$v" "-c default_transaction_read_only=off" check
  if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "$v is set in your shell"; then ok "check: $v in the shell is refused before Docker"; else bad "check: $v accepted (exit $RC): $OUT"; fi
  run_with_shell_value "$v" "-c default_transaction_read_only=off" "${APPLY_ARGS[@]}"
  if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "$v is set in your shell"; then ok "apply: $v in the shell is refused before Docker"; else bad "apply: $v accepted (exit $RC): $OUT"; fi
done
run_with_shell_value STAGING_CA_FILE "/nowhere/ca.crt" check
if [ "$RC" -ne 0 ] && [ "$(docker_calls)" = 0 ] && printf '%s' "$OUT" | grep -q "STAGING_CA_FILE is set in your shell"; then ok "check: STAGING_CA_FILE in the shell is refused before Docker"; else bad "STAGING_CA_FILE from the shell accepted (exit $RC): $OUT"; fi
SBREF=abcdefghijklmnopqrst
printf '%s\n' "STAGING_PROVIDER=supabase" "STAGING_PROJECT_REF=$SBREF" "STAGING_DB_HOST=aws-0-eu-west-2.pooler.supabase.com" "STAGING_DB_PORT=5432" \
  "STAGING_DB_NAME=postgres" "STAGING_DB_USER=postgres.$SBREF" "STAGING_DB_PASSWORD=$FAKE_PW" > "$ENVF";   refused_everywhere "a complete, otherwise valid Supabase settings set" "Supabase is refused"
good > "$ENVF"
run_script plan
if ! printf '%s' "$OUT" | grep -q "nothing is read or changed" && printf '%s' "$OUT" | grep -q "IS read, as plain data"; then ok "plan (file present): the wording says the settings file is read, not 'nothing is read'"; else bad "plan wording (file present): $OUT"; fi
rm -f "$ENVF"
run_script plan
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q "nothing is read or changed" && printf '%s' "$OUT" | grep -q "IS read, as plain data" && printf '%s' "$OUT" | grep -q "TARGET NOT CHECKED"; then ok "plan (file absent): corrected wording, and still says TARGET NOT CHECKED"; else bad "plan wording (file absent): $OUT"; fi

echo; echo "== 7  text checks of the real script"
if awk '/read -r -p "Type STAGING to continue/{f=1} f && /guard_approved_target/{found=1} f && /apply_migrations|close_data_api_defaults/ && !found{late=1} END{exit !(found && !late)}' "$SCRIPT_SRC"; then ok "apply: guard_approved_target runs after the STAGING answer and before the first change"; else bad "late guard call missing or too late"; fi
if grep -qF 'supabase\.(com|co)' "$SCRIPT_SRC"; then ok "the Supabase code has not been deleted (it is refused, not removed)"; else bad "Supabase code missing"; fi

echo; echo "== 8  the fake docker was the only docker, and the only 'run' attempts came from test 1 (accepted settings), all refused by the fake"
TOTAL_RUNS="$(grep -c '^run' "$DOCKER_ALL" || true)"
if [ "$TOTAL_RUNS" = "$ACCEPT_RUNS" ] && [ "$ACCEPT_RUNS" -ge 1 ]; then ok "every refusal test made 0 docker calls; the $ACCEPT_RUNS 'run' attempt(s) belong to the accepted-settings check and went to the fake"
else bad "unexpected docker run attempts: total $TOTAL_RUNS, accepted-check $ACCEPT_RUNS"; fi

echo; echo "staging target guard tests: $PASSES passed, $FAILS failed"
[ "$FAILS" = 0 ]
