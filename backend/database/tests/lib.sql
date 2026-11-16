-- Tiny assertion helpers. Installed ONLY in throw-away test databases (newscafe_test*), never in dev or production.
CREATE OR REPLACE FUNCTION ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', msg; END IF;
  RAISE NOTICE 'ok - %', msg;
END $$;

-- Runs p_sql and requires it to fail with the given SQLSTATE.
CREATE OR REPLACE FUNCTION raises(p_sqlstate text, p_sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_sqlstate THEN
      RAISE NOTICE 'ok - % (raised %)', msg, SQLSTATE;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASSERT FAILED: % - expected % but got % (%)', msg, p_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'ASSERT FAILED: % - expected error % but nothing was raised', msg, p_sqlstate;
END $$;

-- ---- run a statement AS another database role (privilege tests). Test databases only. ----------------------------
-- The caller is the superuser who owns the test database; the role is switched for exactly one statement and reset.
CREATE OR REPLACE FUNCTION raises_as(p_role text, p_sqlstate text, p_sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: % - expected % as % but nothing was raised', msg, p_sqlstate, p_role;
  ELSIF v_state <> p_sqlstate THEN
    RAISE EXCEPTION 'ASSERT FAILED: % - expected % as % but got % (%)', msg, p_sqlstate, p_role, v_state, v_msg;
  END IF;
  RAISE NOTICE 'ok - % (% got %)', msg, p_role, v_state;
END $$;

-- Runs p_sql as p_role and returns the first column of the first row as text (NULL if none). Errors propagate.
CREATE OR REPLACE FUNCTION scalar_as(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;
  RESET ROLE;
  RETURN v;
END $$;

-- Runs p_sql (any statement) as p_role and requires it to succeed.
CREATE OR REPLACE FUNCTION works_as(p_role text, p_sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;
  RESET ROLE;
  RAISE NOTICE 'ok - % (% allowed)', msg, p_role;
END $$;
