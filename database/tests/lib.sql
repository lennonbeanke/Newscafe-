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
