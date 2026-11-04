-- Checks run against a RESTORED copy of the development database (recovery drill).
-- Everything happens in a transaction that is rolled back; nothing in the copy is changed.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_tid uuid; v_during tstzrange; n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_allocations_no_overlap' AND contype = 'x') THEN
    RAISE EXCEPTION 'RESTORE CHECK FAILED: overlap constraint missing';
  END IF;
  IF app_env() <> 'development' THEN RAISE EXCEPTION 'RESTORE CHECK FAILED: environment label is %', app_env(); END IF;
  SELECT count(*) INTO n FROM schema_migrations;
  IF n < 7 THEN RAISE EXCEPTION 'RESTORE CHECK FAILED: only % migrations recorded', n; END IF;

  -- try to double book a table that already has an active allocation: the database must refuse
  SELECT table_id, during INTO v_tid, v_during FROM table_allocations WHERE active LIMIT 1;
  IF v_tid IS NULL THEN RAISE EXCEPTION 'RESTORE CHECK FAILED: no allocations were restored'; END IF;
  BEGIN
    INSERT INTO table_allocations (table_id, kind, during) VALUES (v_tid, 'block', v_during);
    RAISE EXCEPTION 'RESTORE CHECK FAILED: overlapping allocation was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'ok - restored database still refuses a double booking';
  END;
  BEGIN
    DELETE FROM reservation_events;
    RAISE EXCEPTION 'RESTORE CHECK FAILED: history could be deleted';
  EXCEPTION WHEN SQLSTATE 'NC900' THEN
    RAISE NOTICE 'ok - restored database keeps history append-only';
  END;
END $$;
ROLLBACK;
