#!/usr/bin/env bash
# Proves the script-level safeguards: Docker redirection is refused, the engine is the local Colima engine,
# and database/.env is read as plain data (never executed). Touches no database.
set -euo pipefail
. "$(dirname "$0")/../../scripts/lib/common.sh"

# Each check runs in a subshell so its exit does not stop this script.
refused() { local msg="$1"; shift; if ( "$@" ) >/dev/null 2>&1; then die "NOT refused: $msg"; else echo "ok - $msg"; fi; }

# 1. Docker redirection
[ -z "${DOCKER_HOST:-}${DOCKER_CONTEXT:-}" ] || die "run this test with DOCKER_HOST and DOCKER_CONTEXT unset"
refused "DOCKER_HOST set -> refused"    env DOCKER_HOST=tcp://203.0.113.1:2375 bash -c ". '$ROOT/scripts/lib/common.sh'; need_docker"
refused "DOCKER_CONTEXT set -> refused" env DOCKER_CONTEXT=default            bash -c ". '$ROOT/scripts/lib/common.sh'; need_docker"
need_docker
echo "ok - Docker is the local Colima engine ($(docker context show), engine name '$(docker info --format '{{.Name}}')')"

# 2. .env read as data, with a throw-away file and a marker that code execution would create
T="$(mktemp -d "$ROOT/.envtest.XXXXXX")"; trap 'rm -rf "$T"' EXIT
# with_value KEY VALUE: a complete, valid .env in which only KEY has a different value (so no other rule can be the cause).
with_value() {
  local k v
  for k in APP_ENV POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_PORT; do
    case "$k" in
      APP_ENV) v=development;; POSTGRES_USER) v=u1;; POSTGRES_PASSWORD) v=abc123;; POSTGRES_DB) v=newscafe_dev;; POSTGRES_PORT) v=54329;;
    esac
    [ "$k" = "$1" ] && v="$2"
    echo "$k=$v"
  done
}
# Reads a .env from stdin and loads it in a subshell.
try_env() { ( ENV_FILE="$T/env"; cat > "$ENV_FILE"; load_env_file ) ; }
# The refusal must come from the intended rule, not from some other failure.
refused_for() {
  local why="$1" desc="$2" out
  out="$(try_env 2>&1)" && die "NOT refused: $desc"
  case "$out" in *"$why"*) echo "ok - $desc";; *) die "refused for the wrong reason ($desc): $out";; esac
}
with_value APP_ENV development | try_env >/dev/null && echo "ok - a normal .env is accepted"
with_value POSTGRES_PASSWORD "\$(touch $T/EXECUTED)" | refused_for "not allowed" ".env value with \$(command) is refused, not run"
with_value POSTGRES_USER "\`touch $T/EXECUTED\`"   | refused_for "not allowed" ".env value with backticks is refused, not run"
with_value POSTGRES_DB "newscafe_dev;touch $T/EXECUTED" | refused_for "not allowed" ".env value with ; is refused"
with_value POSTGRES_PASSWORD "a b"                     | refused_for "not allowed" ".env value with a space is refused"
with_value POSTGRES_PASSWORD "'x'"                     | refused_for "not allowed" ".env value with quotes is refused"
{ with_value APP_ENV development; echo "touch $T/EXECUTED"; } | refused_for "not KEY=VALUE" ".env with a shell command line is refused"
{ with_value APP_ENV development; echo "PATH=/tmp"; }          | refused_for "unknown key" ".env with an unknown key is refused"
{ with_value APP_ENV development; echo "APP_ENV=production"; } | refused_for "more than once" ".env with a repeated key is refused"
[ ! -e "$T/EXECUTED" ] || die "something in .env was EXECUTED"
echo "ok - nothing inside .env was executed"
echo "script guard tests passed"
