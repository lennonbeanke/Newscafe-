#!/usr/bin/env bash
# API checks: type-check, then the automated tests against a THROW-AWAY database (newscafe_test_apihttp) with real
# newscafe_public / newscafe_admin logins and fake data only. The development database is never touched.
# Usage: backend/scripts/api-test.sh [vitest args, e.g. test/http.public.test.ts]
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
TESTDB=newscafe_test_apihttp
PRODDB=newscafe_test_apiprod        # labelled 'production' (allowed only for newscafe_test* databases): the API must refuse it
[ -d "$ROOT/node_modules" ] || die "backend/node_modules is missing. Run:  cd backend && npm ci --ignore-scripts"
drop_db "$TESTDB" >/dev/null 2>&1 || true; drop_db "$PRODDB" >/dev/null 2>&1 || true
create_db "$TESTDB"; create_db "$PRODDB"
trap 'drop_db "$TESTDB" >/dev/null 2>&1 || true; drop_db "$PRODDB" >/dev/null 2>&1 || true' EXIT
migrate_db "$TESTDB" development >/dev/null
migrate_db "$PRODDB" production >/dev/null
"$ROOT/scripts/gen-api-env.sh" >/dev/null
"$ROOT/scripts/db-roles.sh" >/dev/null
load_env_file "$API_PUBLIC_ENV_FILE" $API_PUBLIC_ENV_KEYS
load_env_file "$API_ADMIN_ENV_FILE" $API_ADMIN_ENV_KEYS
export API_DB_NAME="$TESTDB" TEST_PROD_DB="$PRODDB"
# Superuser access is for test FIXTURES only (never used by the API itself). Passed through the environment, not a command line.
export TEST_SU_USER="$POSTGRES_USER" TEST_SU_PASSWORD="$POSTGRES_PASSWORD"
cd "$ROOT"
echo "== type-check"; ./node_modules/.bin/tsc --noEmit && echo "   ok"
echo "== tests"; ./node_modules/.bin/vitest run "$@"
