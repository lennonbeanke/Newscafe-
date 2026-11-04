-- 0001: extensions, environment label, shared helper functions.
-- Error codes used by this schema (custom SQLSTATE, class "NC"):
--   NC001 booking rules not configured     NC002 no suitable table available
--   NC004 party size not allowed           NC005 outside notice / advance window
--   NC006 start time not on a slot         NC007 restaurant closed at that time
--   NC008 consent missing                  NC900 append-only / immutable data
--   NC901 test e-mail address in production NC903 allocation does not match reservation

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- One row that says which environment this database belongs to. It is set once by the
-- migration script and can never be changed (see forbid_change below).
CREATE TABLE app_environment (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  env    text NOT NULL CHECK (env IN ('development', 'staging', 'production')),
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app_env() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT env FROM app_environment $$;

CREATE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only / immutable data)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'NC900';
END $$;

CREATE TRIGGER app_environment_immutable
  BEFORE UPDATE OR DELETE ON app_environment
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER app_environment_no_truncate
  BEFORE TRUNCATE ON app_environment
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Test addresses (@example.invalid) are only ever used for fake data. Production refuses them.
-- Usage: CREATE TRIGGER ... EXECUTE FUNCTION reject_fake_email('column_name');
CREATE FUNCTION reject_fake_email() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v text := to_jsonb(NEW) ->> TG_ARGV[0];
BEGIN
  IF app_env() = 'production' AND v IS NOT NULL AND lower(v) LIKE '%@example.invalid' THEN
    RAISE EXCEPTION 'Test e-mail addresses (@example.invalid) are not accepted in production'
      USING ERRCODE = 'NC901';
  END IF;
  RETURN NEW;
END $$;
