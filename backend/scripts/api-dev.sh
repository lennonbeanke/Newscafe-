#!/usr/bin/env bash
# Starts BOTH API processes for local development (Ctrl-C stops both):
#   public API  http://127.0.0.1:8787  (booking endpoints; holds only the public database login)
#   owner API   http://127.0.0.1:8788  (owner sign-in and reservation management; holds only the admin database login)
# Needs: Colima + the dev database running (backend/scripts/colima-up.sh, backend/scripts/db-up.sh) and the API roles enabled (backend/scripts/db-roles.sh).
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
"$ROOT/scripts/gen-api-env.sh" >/dev/null
# refuse env files that are not plain KEY=VALUE data, and check each holds only its own process's settings
load_env_file "$API_PUBLIC_ENV_FILE" $API_PUBLIC_ENV_KEYS >/dev/null
load_env_file "$API_ADMIN_ENV_FILE" $API_ADMIN_ENV_KEYS >/dev/null
cd "$ROOT"
[ -d node_modules ] || die "backend/node_modules is missing. Run:  cd backend && npm ci --ignore-scripts"
NODE="$(command -v node)"
# each process gets ONLY its own env file (the other's secrets are never in its environment)
env -i PATH="$PATH" HOME="$HOME" "$NODE" --env-file=.env.public src/server-public.ts & PUBLIC_PID=$!
env -i PATH="$PATH" HOME="$HOME" "$NODE" --env-file=.env.admin src/server-admin.ts & ADMIN_PID=$!
trap 'kill $PUBLIC_PID $ADMIN_PID 2>/dev/null || true' INT TERM EXIT
while kill -0 "$PUBLIC_PID" 2>/dev/null && kill -0 "$ADMIN_PID" 2>/dev/null; do sleep 1; done
echo "One of the API processes stopped; stopping the other." >&2
