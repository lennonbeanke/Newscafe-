#!/usr/bin/env bash
# Keeps the two working areas separate. No Docker needed. Used by the pre-commit hook and CI.
#   frontend/  talks to the backend ONLY through HTTP (/api/admin/*), never by importing or reading backend files or secrets.
#   backend/   never imports or reads frontend files.
#   e2e/       is the one place allowed to look at both (tests that need both areas).
# Comment lines are ignored (they may explain the rule); everything else is checked.
set -eu   # no pipefail: grep exits 1 when it finds nothing, which is the good case here
TOP="$(git rev-parse --show-toplevel)"
cd "$TOP"
fail=0

# strips full-line comments (// ...  * ...  # ...) from grep -n output "file:line:text"
code_only() { grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*|#|--)' || true; }

echo "check-boundaries: frontend must not reach into backend/"
hits="$(grep -rnIE '(\.\./)+backend|(^|[^A-Za-z0-9_])backend/(src|database|docs|test|tools|scripts)' frontend \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=public --exclude=package-lock.json | code_only)"
[ -z "$hits" ] || { echo "$hits" | cut -c1-160; echo "  ^ the frontend must use the HTTP API only (see e2e/ for tests that need both areas)"; fail=1; }

echo "check-boundaries: no backend secret names in frontend/ (the page and its tests never know them)"
# the static security test lists these names as patterns it forbids, so it is the one file allowed to spell them out
hits="$(grep -rnIE 'API_HMAC_KEY|API_TOTP_ENC_KEY|API_DB_[A-Z_]*(PASSWORD|USER)|POSTGRES_(PASSWORD|USER)' frontend \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=public --exclude=package-lock.json \
  --exclude=security-static.test.mjs || true)"
[ -z "$hits" ] || { echo "$hits" | cut -c1-160; echo "  ^ backend secrets must never appear in the frontend"; fail=1; }

echo "check-boundaries: frontend has no environment file with real values"
bad="$(git ls-files frontend | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)"
[ -z "$bad" ] || { echo "$bad"; echo "  ^ environment files are git-ignored; only .env.example is allowed"; fail=1; }

echo "check-boundaries: backend must not reach into frontend/"
hits="$(grep -rnIE '(\.\./)+frontend|(^|[^A-Za-z0-9_])frontend/(app|components|lib|tests|public)' backend/src backend/test backend/tools backend/scripts backend/database 2>/dev/null | code_only)"
[ -z "$hits" ] || { echo "$hits" | cut -c1-160; fail=1; }

echo "check-boundaries: public and admin processes stay separate"
if grep -nE "from '\./(public-app|services)" backend/src/admin-app.ts backend/src/server-admin.ts >/dev/null 2>&1; then
  grep -nE "from '\./(public-app|services)" backend/src/admin-app.ts backend/src/server-admin.ts; echo "  ^ the admin process must not import the public application or its services"; fail=1
fi
if grep -nE "from '\./(admin-app|admin/)" backend/src/public-app.ts backend/src/server-public.ts >/dev/null 2>&1; then
  grep -nE "from '\./(admin-app|admin/)" backend/src/public-app.ts backend/src/server-public.ts; echo "  ^ the public process must not import the admin application"; fail=1
fi

[ "$fail" = 0 ] || { echo "check-boundaries FAILED" >&2; exit 1; }
echo "check-boundaries: OK (frontend and backend only meet over HTTP; admin and public processes are separate)"
