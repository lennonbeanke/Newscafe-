-- 0006: owner accounts, sessions, login attempts, audit log, idempotency.
-- There is NO sign-up path: no public registration function, endpoint or table exists. Owner accounts are
-- created only by a developer-run script after the owner approves. Password hashing (Argon2id), session
-- handling and rate limiting are implemented by the API in a later milestone; this schema only stores the results.
-- No accounts, hashes or secrets are created by migrations.

CREATE TABLE admin_users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  password_hash         text NOT NULL,             -- Argon2id hash only, never a password
  role                  text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager')),
  totp_secret_encrypted bytea,
  failed_logins         integer NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until          timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz
);
CREATE TRIGGER admin_users_no_fake_email BEFORE INSERT OR UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION reject_fake_email('email');

CREATE TABLE admin_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,                -- only a hash of the session token is stored
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_hash    text,
  user_agent text
);
CREATE INDEX admin_sessions_user ON admin_sessions (user_id);

CREATE TABLE login_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_hash     text NOT NULL,                      -- hash of IP / e-mail, never the raw value
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success      boolean NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts (key_hash, attempted_at DESC);

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip_hash     text
);
CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id, at DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TABLE idempotency_keys (
  key          text PRIMARY KEY,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_uploaded_by_fk
  FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL;
