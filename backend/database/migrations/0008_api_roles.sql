-- 0008: least-privilege database roles for the API, plus the extra columns/table the owner login needs.
--
-- Three roles, all created NOLOGIN and WITHOUT passwords (migrations contain no secrets).
-- scripts/db-roles.sh turns on LOGIN with random development passwords taken from the git-ignored backend/.env.public / .env.admin.
--   newscafe_definer  owns the SECURITY DEFINER functions (0009). It is NOT a superuser; it holds only the table
--                     privileges those functions need. Nobody logs in as this role.
--   newscafe_public   used by the public API endpoints. It has NO table privileges at all: it can only call the two
--                     public_* functions (0009), which hard-code safe values (source 'web', not a test, consent now).
--   newscafe_admin    used by the owner-only admin endpoints. It can read what the dashboard shows and write only the
--                     login/session/audit tables; every change to a reservation goes through an admin_* function.
-- The database-level safeguards of 0001-0007 (exclusion constraint, append-only history, environment label) are unchanged.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'newscafe_definer') THEN
    CREATE ROLE newscafe_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'newscafe_public') THEN
    CREATE ROLE newscafe_public NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'newscafe_admin') THEN
    CREATE ROLE newscafe_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Guard rails on every API connection: short waits, no long-lived idle transactions.
ALTER ROLE newscafe_public SET statement_timeout = '5s';
ALTER ROLE newscafe_public SET lock_timeout = '3s';
ALTER ROLE newscafe_public SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE newscafe_admin  SET statement_timeout = '10s';
ALTER ROLE newscafe_admin  SET lock_timeout = '3s';
ALTER ROLE newscafe_admin  SET idle_in_transaction_session_timeout = '10s';

-- Only these roles (and the superuser who runs migrations) may connect to this database.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO newscafe_public, newscafe_admin', current_database());
END $$;

-- From now on, new functions are closed to everybody until a migration grants them explicitly.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The A1 booking functions must not be callable by the API roles directly: book_reservation() accepts a "source"
-- and "is_test" argument, which a public client must never control. They stay available to the definer role only.
REVOKE EXECUTE ON FUNCTION book_reservation(uuid, integer, timestamptz, text, text, text, text, text, boolean, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION available_tables(uuid, integer, tstzrange, boolean)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION available_combinations(uuid, integer, tstzrange, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_duration(uuid, integer, timestamptz)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_within_opening(uuid, timestamptz, integer)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION opening_windows(uuid, date)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION location_tz(uuid)                                         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION book_reservation(uuid, integer, timestamptz, text, text, text, text, text, boolean, timestamptz, text) TO newscafe_definer;
GRANT EXECUTE ON FUNCTION available_tables(uuid, integer, tstzrange, boolean)       TO newscafe_definer;
GRANT EXECUTE ON FUNCTION available_combinations(uuid, integer, tstzrange, boolean) TO newscafe_definer;
GRANT EXECUTE ON FUNCTION resolve_duration(uuid, integer, timestamptz)              TO newscafe_definer;
GRANT EXECUTE ON FUNCTION is_within_opening(uuid, timestamptz, integer)             TO newscafe_definer;
GRANT EXECUTE ON FUNCTION opening_windows(uuid, date)                               TO newscafe_definer;
GRANT EXECUTE ON FUNCTION location_tz(uuid)                                         TO newscafe_definer;

-- ---- owner login: what the API needs to store -----------------------------------------------------------------
ALTER TABLE admin_users
  ADD COLUMN totp_confirmed_at   timestamptz,        -- set when the owner has proven the authenticator app works
  ADD COLUMN totp_last_step      bigint,             -- last accepted 30 s step: a code can never be used twice
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE admin_sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),   -- idle timeout
  ADD COLUMN mfa_pending  boolean     NOT NULL DEFAULT false;   -- password accepted, authenticator code still required

-- One-time recovery codes for a lost authenticator. Only a keyed hash of each code is stored.
CREATE TABLE admin_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash  bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz
);
CREATE INDEX admin_recovery_codes_user ON admin_recovery_codes (user_id);

-- ---- newscafe_definer: exactly what the SECURITY DEFINER functions need ------------------------------------------
GRANT SELECT ON locations, opening_hours, special_hours, reservation_settings, duration_rules, dining_tables,
                table_combinations, table_combination_members, reservations, table_allocations,
                app_environment, admin_users TO newscafe_definer;
GRANT INSERT, UPDATE         ON reservations      TO newscafe_definer;
GRANT INSERT, UPDATE, DELETE ON table_allocations TO newscafe_definer;
GRANT INSERT ON reservation_events, audit_logs    TO newscafe_definer;
GRANT UPDATE (sort) ON dining_tables              TO newscafe_definer;   -- row locks (FOR UPDATE) need an UPDATE privilege

-- ---- newscafe_admin: read what the dashboard shows; write only login/session/audit data ---------------------------
GRANT SELECT ON locations, opening_hours, special_hours, reservation_settings, duration_rules, dining_tables,
                table_combinations, table_combination_members, reservations, table_allocations,
                reservation_events, reservation_readiness, app_environment, audit_logs,
                admin_users, admin_sessions, login_attempts, admin_recovery_codes TO newscafe_admin;
GRANT UPDATE (password_hash, failed_logins, locked_until, last_login_at, totp_secret_encrypted,
              totp_confirmed_at, totp_last_step, password_changed_at) ON admin_users TO newscafe_admin;
GRANT INSERT ON admin_sessions TO newscafe_admin;
GRANT UPDATE (revoked_at, last_seen_at, mfa_pending, expires_at) ON admin_sessions TO newscafe_admin;
GRANT INSERT ON login_attempts, audit_logs TO newscafe_admin;
GRANT INSERT ON admin_recovery_codes TO newscafe_admin;
GRANT UPDATE (used_at) ON admin_recovery_codes TO newscafe_admin;
-- Deliberately NOT granted to either role: INSERT on admin_users (there is no registration path), any write to
-- reservations / table_allocations / reservation_events, UPDATE/DELETE/TRUNCATE on audit_logs, and any DDL.
