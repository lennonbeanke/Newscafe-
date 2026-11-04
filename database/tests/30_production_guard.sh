#!/usr/bin/env bash
# Proves the production safeguards using a throw-away database that is labelled 'production'
# (the label is only permitted on newscafe_test* databases). Usage: 30_production_guard.sh <dbname>
set -euo pipefail
. "$(dirname "$0")/../../scripts/lib/common.sh"
guard_dev
DB="${1:?database name}"
[[ "$DB" =~ ^newscafe_test ]] || die "Production-guard tests only run on newscafe_test* databases."

drop_db "$DB"; create_db "$DB"
migrate_db "$DB" production >/dev/null
psql_db "$DB" -f - < "$ROOT/database/tests/lib.sql" >/dev/null
psql_db "$DB" -f - <<'SQL'
\set ON_ERROR_STOP on
SELECT ok(app_env() = 'production', 'database is labelled production');
SELECT raises('NC901', $q$INSERT INTO contact_messages (name, email, message) VALUES ('X', 'someone@example.invalid', 'hi')$q$,
              'production refuses @example.invalid in contact messages');
SELECT raises('NC901', $q$INSERT INTO function_enquiries (name, email) VALUES ('X', 'Someone@EXAMPLE.INVALID')$q$,
              'production refuses @example.invalid in function enquiries (case-insensitive)');
SELECT raises('NC901', $q$INSERT INTO admin_users (email, password_hash) VALUES ('a@example.invalid', 'x')$q$,
              'production refuses @example.invalid for owner accounts');
INSERT INTO contact_messages (name, email, message) VALUES ('Real Format', 'person@example.com', 'ok');
SELECT ok((SELECT count(*) FROM contact_messages) = 1, 'ordinary e-mail addresses are accepted');
SELECT raises('NC900', $q$UPDATE app_environment SET env = 'development'$q$, 'a production database cannot be relabelled');
-- production can hold flagged test bookings, but they never appear in live reports
INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES ('00000000-0000-4000-8000-0000000000f1','P','1','T','T','T','0');
INSERT INTO reservations (location_id, party_size, starts_at, ends_at, duration_minutes, guest_name, guest_phone, is_test)
VALUES ('00000000-0000-4000-8000-0000000000f1', 2, now() + interval '2 days', now() + interval '2 days 1 hour', 60, 'Launch check', '+27000000000', true);
SELECT ok((SELECT count(*) FROM reservations_live) = 0, 'flagged launch-check booking is excluded from live reports');
SQL

# The seed file must refuse to run against a production-labelled database.
if psql_db "$DB" -f - < "$ROOT/database/seed/dev_seed.sql" >/dev/null 2>&1; then
  die "seed ran against a production-labelled database!"
fi
echo "ok - dev seed refuses to run on a production-labelled database"

# The seed must also refuse a development-labelled database that is not named newscafe_dev.
DEVLABEL="${DB}_devlabel"
drop_db "$DEVLABEL"; create_db "$DEVLABEL"
migrate_db "$DEVLABEL" development >/dev/null
if psql_db "$DEVLABEL" -f - < "$ROOT/database/seed/dev_seed.sql" >/dev/null 2>&1; then
  drop_db "$DEVLABEL"; die "seed ran against a database not named newscafe_dev!"
fi
[ "$(psql_db "$DEVLABEL" -tA -c "SELECT count(*) FROM locations")" = "0" ] || { drop_db "$DEVLABEL"; die "seed left data behind"; }
drop_db "$DEVLABEL"
echo "ok - dev seed refuses to run on a development-labelled database not named newscafe_dev"

# Scripts must refuse non-dev database names.
( guard_db_name "newscafe_production" ) 2>/dev/null && die "guard accepted newscafe_production" || echo "ok - scripts refuse a database named newscafe_production"
( guard_db_name "postgres" ) 2>/dev/null && die "guard accepted postgres" || echo "ok - scripts refuse the postgres database"
drop_db "$DB"
