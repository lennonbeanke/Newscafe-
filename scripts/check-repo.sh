#!/usr/bin/env bash
# Static safety check for what is about to be committed. No Docker needed. Used by the pre-commit hook and CI.
# Fails if: the repository root is wrong, a forbidden file is staged, a path is outside the allow-list, or a file is huge.
set -euo pipefail
EXPECTED_NAME="Newscafe"
TOP="$(git rev-parse --show-toplevel)"
[ "$(basename "$TOP")" = "$EXPECTED_NAME" ] || [ -n "${CI:-}" ] || { echo "REFUSED: repository root is '$TOP' (expected the News Cafe project folder)." >&2; exit 1; }
[ -d "$TOP/database" ] && [ -d "$TOP/frontend" ] || { echo "REFUSED: '$TOP' does not look like the News Cafe project." >&2; exit 1; }
cd "$TOP"

if [ "${1:-}" = "--tracked" ]; then LIST="$(git ls-files)"; else LIST="$(git diff --cached --name-only --diff-filter=ACMR)"; fi
[ -n "$LIST" ] || { echo "check-repo: nothing to check."; exit 0; }

fail=0
while IFS= read -r f; do
  case "$f" in
    .gitignore|.gitattributes|README.md|.github/workflows/ci.yml) ;;
    frontend/*|database/*|scripts/*|docs/*) ;;
    *) echo "NOT ALLOWED (outside the allow-list): $f"; fail=1;;
  esac
  case "$(basename "$f" | tr 'A-Z' 'a-z')" in
    *.pdf) echo "FORBIDDEN (PDF): $f"; fail=1;;
    .env|.env.*) [ "$(basename "$f")" = ".env.example" ] || { echo "FORBIDDEN (env file): $f"; fail=1; };;
    *.pem|*.key|*.p12|*.pfx|*.crt|id_rsa*|*.dump|*.bak|*.age|*.sql.gz) echo "FORBIDDEN (key/dump/backup): $f"; fail=1;;
  esac
  case "$f" in design-options/*|final-review/*|*/backups/*|*/node_modules/*) echo "FORBIDDEN (excluded folder): $f"; fail=1;; esac
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 10485760 ]; then echo "TOO LARGE (>10 MB): $f"; fail=1; fi
done <<< "$LIST"
[ "$fail" = 0 ] || { echo "check-repo FAILED" >&2; exit 1; }
echo "check-repo: $(echo "$LIST" | wc -l | tr -d ' ') files OK (allow-list, no PDFs, secrets, dumps or keys)"
