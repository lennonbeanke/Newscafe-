#!/usr/bin/env bash
# Loads FAKE development data (database/seed/dev_seed.sql). Refuses unless the database is labelled 'development' and empty.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
need_docker; guard_dev
psql_db "$POSTGRES_DB" -f - < "$ROOT/database/seed/dev_seed.sql"
echo "Fake development data loaded (all customer data is fictional)."
