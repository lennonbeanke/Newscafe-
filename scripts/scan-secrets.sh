#!/usr/bin/env bash
# Secret scan with gitleaks (official image, pinned version) over exactly what would be committed.
# Usage: scan-secrets.sh            -> staged files        scan-secrets.sh --tracked -> everything tracked
# The files are copied to a temporary folder INSIDE the project (the container VM only shares the home folder),
# mounted read-only, and deleted afterwards. The scan FAILS if gitleaks saw no data, so it can never pass silently.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker   # refuses redirected/non-Colima engines; the secret scan cannot be skipped (start with scripts/colima-up.sh)
TOP="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d "$TOP/.scan.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
cd "$TOP"
if [ "${1:-}" = "--tracked" ]; then git archive HEAD | tar -x -C "$TMP"      # everything committed
else git checkout-index --all --prefix="$TMP/"; fi                           # exactly what is staged
EXPECTED="$(find "$TMP" -type f | wc -l | tr -d ' ')"
[ "$EXPECTED" -gt 0 ] || die "Nothing to scan."
set +e
OUT="$(docker run --rm -v "$TMP:/scan:ro" "$GITLEAKS_IMAGE" dir /scan --no-banner --redact --exit-code 1 2>&1)"
RC=$?
set -e
echo "$OUT" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "scanned|leaks|Finding|RuleID|File:" | head -20
echo "$OUT" | sed 's/\x1b\[[0-9;]*m//g' | grep -q "scanned ~0 bytes" && die "gitleaks scanned 0 bytes (mount problem). Commit refused."
[ "$RC" = 0 ] || die "gitleaks reported possible secrets (values are redacted). Commit refused."
echo "scan-secrets: $EXPECTED files scanned, no secrets found"
