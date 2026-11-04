-- Reservation logic tests. Everything runs inside one transaction that is rolled back at the end.
-- All data is fictional. Requires tests/lib.sql (ok / raises helpers).
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.lt(d date, t time) RETURNS timestamptz LANGUAGE sql AS
$$ SELECT (d + t) AT TIME ZONE 'Africa/Johannesburg' $$;

CREATE FUNCTION pg_temp.call(p_loc uuid, p_party integer, p_start timestamptz, p_src text DEFAULT 'web',
                             p_key text DEFAULT NULL, p_test boolean DEFAULT false) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT book_reservation(%L,%s,%L,%L,%L,%L,NULL,%L,%L,now(),%L)',
                 p_loc, p_party, p_start, 'Test Guest', 'g@example.com', '+27000000000', p_src, p_test, p_key) $$;

CREATE FUNCTION pg_temp.bk(p_loc uuid, p_party integer, p_start timestamptz, p_src text DEFAULT 'web',
                           p_key text DEFAULT NULL, p_test boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS
$$ DECLARE r uuid; BEGIN EXECUTE pg_temp.call(p_loc, p_party, p_start, p_src, p_key, p_test) INTO r; RETURN r; END $$;

CREATE FUNCTION pg_temp.lbl(p_res uuid) RETURNS text LANGUAGE sql AS
$$ SELECT string_agg(t.label, '+' ORDER BY t.label)
     FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id
    WHERE a.reservation_id = p_res AND a.active $$;

INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'TEST A', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000b1', 'TEST B unconfigured', '1 Test St', 'T', 'T', 'T', '0000');
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at)
SELECT '00000000-0000-4000-8000-0000000000a1', d, time '10:00', time '22:00' FROM generate_series(1, 7) d;

DO $$
DECLARE
  a   constant uuid := '00000000-0000-4000-8000-0000000000a1';
  b   constant uuid := '00000000-0000-4000-8000-0000000000b1';
  d0  date := current_date + 30;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; rc uuid; rt uuid; rk uuid;
  n   integer;
BEGIN
  -- ---------- nothing is assumed: unconfigured locations cannot take bookings ----------
  PERFORM raises('NC001', pg_temp.call(b, 2, pg_temp.lt(d0, '19:00')), 'unconfigured location refuses booking');
  PERFORM raises('NC001', pg_temp.call(a, 2, pg_temp.lt(d0, '19:00')), 'no settings row refuses booking');
  INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
      max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
  VALUES (a, 30, 0, 1, 10, 0, 3650, 0);
  PERFORM raises('NC001', pg_temp.call(a, 2, pg_temp.lt(d0, '19:00')), 'no duration rule refuses booking');
  PERFORM ok(resolve_duration(a, 2, pg_temp.lt(d0, '19:00')) IS NULL, 'resolve_duration is NULL without rules');

  -- ---------- configurable durations ----------
  INSERT INTO duration_rules (location_id, name, min_party, max_party, duration_minutes, priority) VALUES
    (a, 'default', NULL, NULL, 90, 0),
    (a, 'small', 1, 2, 60, 0),
    (a, 'six exactly', 6, 6, 150, 5);
  PERFORM ok(resolve_duration(a, 2, pg_temp.lt(d0, '19:00')) = 60, 'party of 2 uses the more specific 60 min rule');
  PERFORM ok(resolve_duration(a, 4, pg_temp.lt(d0, '19:00')) = 90, 'party of 4 falls back to the default 90 min rule');
  PERFORM ok(resolve_duration(a, 6, pg_temp.lt(d0, '19:00')) = 150, 'higher priority rule wins for party of 6');

  -- ---------- tables ----------
  INSERT INTO dining_tables (location_id, label, min_covers, max_covers, online_bookable, is_active, sort) VALUES
    (a, 'T01', 1, 2, true, true, 1), (a, 'T02', 1, 2, true, true, 2), (a, 'T03', 1, 2, true, true, 3),
    (a, 'T04', 2, 4, true, true, 4), (a, 'T05', 2, 4, true, true, 5),
    (a, 'T06', 1, 4, false, true, 6),      -- walk-in only
    (a, 'T07', 2, 2, true, false, 7);      -- disabled
  INSERT INTO table_combinations (id, location_id, name, min_covers, max_covers)
  VALUES ('00000000-0000-4000-8000-0000000000c1', a, 'T04+T05', 5, 8);
  INSERT INTO table_combination_members (combination_id, table_id)
  SELECT '00000000-0000-4000-8000-0000000000c1', id FROM dining_tables WHERE location_id = a AND label IN ('T04', 'T05');

  -- ---------- booking, overlap and capacity ----------
  r1 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'));
  PERFORM ok(pg_temp.lbl(r1) = 'T01', 'party of 2 gets the best-fitting table (T01)');
  PERFORM ok((SELECT status FROM reservations WHERE id = r1) = 'pending', 'web booking is pending (auto-confirm is off)');
  PERFORM ok((SELECT ends_at FROM reservations WHERE id = r1) = pg_temp.lt(d0, '20:00'), 'end time = start + 60 min');
  r2 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'));
  r3 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'));
  PERFORM ok(pg_temp.lbl(r2) = 'T02' AND pg_temp.lbl(r3) = 'T03', 'next parties get T02 and T03, never the same table');
  r4 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'));
  r5 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'));
  PERFORM ok(pg_temp.lbl(r4) = 'T04' AND pg_temp.lbl(r5) = 'T05', 'two-tops full: party of 2 uses four-tops');
  PERFORM raises('NC002', pg_temp.call(a, 2, pg_temp.lt(d0, '19:00')),
                 'no table left for web booking (walk-in-only and disabled tables are never used)');
  r6 := pg_temp.bk(a, 2, pg_temp.lt(d0, '19:00'), 'admin');
  PERFORM ok(pg_temp.lbl(r6) = 'T06', 'staff booking may use the walk-in-only table');
  PERFORM ok((SELECT status FROM reservations WHERE id = r6) = 'confirmed', 'staff booking is confirmed');
  PERFORM raises('NC002', pg_temp.call(a, 2, pg_temp.lt(d0, '19:00'), 'admin'), 'disabled table is never used, even by staff');

  -- back-to-back: a booking starting exactly when another ends does not conflict
  r7 := pg_temp.bk(a, 2, pg_temp.lt(d0, '20:00'));
  PERFORM ok(pg_temp.lbl(r7) = 'T01', 'back-to-back booking reuses T01 (ranges are half-open)');

  -- turnaround buffer blocks the table for longer
  UPDATE reservation_settings SET turnaround_buffer_minutes = 15 WHERE location_id = a;
  rt := pg_temp.bk(a, 2, pg_temp.lt(d0 + 1, '12:00'));
  rk := pg_temp.bk(a, 2, pg_temp.lt(d0 + 1, '13:00'));
  PERFORM ok(pg_temp.lbl(rt) = 'T01' AND pg_temp.lbl(rk) = 'T02', 'turnaround buffer keeps T01 blocked after the booking ends');
  UPDATE reservation_settings SET turnaround_buffer_minutes = 0 WHERE location_id = a;

  -- party sizes
  PERFORM raises('NC004', pg_temp.call(a, 11, pg_temp.lt(d0 + 2, '19:00')), 'party above the online maximum is refused');
  PERFORM raises('NC004', pg_temp.call(a, 0, pg_temp.lt(d0 + 2, '19:00')), 'party of 0 is refused');

  -- combinations
  rc := pg_temp.bk(a, 7, pg_temp.lt(d0 + 2, '19:00'));
  PERFORM ok(pg_temp.lbl(rc) = 'T04+T05', 'party of 7 is seated on the T04+T05 combination');
  PERFORM ok((SELECT count(*) FROM table_allocations WHERE reservation_id = rc AND active) = 2,
             'a combination holds one allocation per member table');
  PERFORM raises('NC002', pg_temp.call(a, 6, pg_temp.lt(d0 + 2, '19:00')), 'combination is not reusable while its tables are held');
  r1 := pg_temp.bk(a, 4, pg_temp.lt(d0 + 3, '19:00'));
  PERFORM ok(pg_temp.lbl(r1) = 'T04', 'party of 4 takes T04');
  PERFORM raises('NC002', pg_temp.call(a, 7, pg_temp.lt(d0 + 3, '19:00')), 'combination unavailable while one member table is busy');

  -- cancelling frees tables; reinstating re-checks the constraint
  UPDATE reservations SET status = 'cancelled' WHERE id = r1;
  PERFORM ok((SELECT count(*) FROM table_allocations WHERE reservation_id = r1 AND active) = 0, 'cancelled booking releases its table');
  r2 := pg_temp.bk(a, 7, pg_temp.lt(d0 + 3, '19:00'));
  PERFORM ok(pg_temp.lbl(r2) = 'T04+T05', 'combination is bookable again after the cancellation');
  PERFORM raises('23P01', format('UPDATE reservations SET status = %L WHERE id = %L', 'confirmed', r1),
                 'reinstating a cancelled booking whose table is taken is rejected by the database');
  r3 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 4, '19:00'));
  UPDATE reservations SET status = 'no_show' WHERE id = r3;
  PERFORM ok((SELECT count(*) FROM table_allocations WHERE reservation_id = r3 AND active) = 0, 'no-show releases its table');

  -- opening hours
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 5, '09:00')), 'before opening is refused');
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 5, '22:00')), 'at closing time is refused');
  PERFORM ok(pg_temp.bk(a, 2, pg_temp.lt(d0 + 5, '21:30')) IS NOT NULL, '21:30 is accepted when there is no last-seating rule');
  UPDATE reservation_settings SET last_seating_before_close_minutes = 60 WHERE location_id = a;
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 6, '21:30')), 'last-seating rule refuses 21:30');
  UPDATE reservation_settings SET last_seating_before_close_minutes = 0 WHERE location_id = a;
  INSERT INTO special_hours (location_id, on_date, opens_at, closes_at, closes_next_day, label)
  VALUES (a, d0 + 8, '18:00', '02:00', true, 'past midnight');
  PERFORM ok(pg_temp.bk(a, 2, pg_temp.lt(d0 + 9, '00:30')) IS NOT NULL, 'past-midnight service accepts 00:30 the next morning');
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 9, '02:00')), 'past-midnight service refuses its own closing time');
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 8, '12:00')), 'special hours replace the weekly hours for that date');
  INSERT INTO special_hours (location_id, on_date, is_closed, label) VALUES (a, d0 + 10, true, 'closed');
  PERFORM raises('NC007', pg_temp.call(a, 2, pg_temp.lt(d0 + 10, '19:00')), 'closed date refuses bookings');

  -- slots, notice, advance window, consent
  PERFORM raises('NC006', pg_temp.call(a, 2, pg_temp.lt(d0 + 11, '19:10')), 'start time must be on a slot');
  UPDATE reservation_settings SET min_notice_minutes = 100000 WHERE location_id = a;
  PERFORM raises('NC005', pg_temp.call(a, 2, pg_temp.lt(d0 + 11, '19:00')), 'minimum notice is enforced');
  UPDATE reservation_settings SET min_notice_minutes = 0, max_advance_days = 10 WHERE location_id = a;
  PERFORM raises('NC005', pg_temp.call(a, 2, pg_temp.lt(d0 + 11, '19:00')), 'advance booking limit is enforced');
  UPDATE reservation_settings SET max_advance_days = 3650 WHERE location_id = a;
  PERFORM raises('NC008', format('SELECT book_reservation(%L,2,%L,%L,%L,NULL,NULL,%L,false,NULL,NULL)',
                                 a, pg_temp.lt(d0 + 11, '19:00'), 'G', 'g@example.com', 'web'),
                 'online booking requires consent');

  -- changing a duration rule affects new bookings only
  r4 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 12, '19:00'));
  UPDATE duration_rules SET duration_minutes = 45 WHERE location_id = a AND name = 'small';
  PERFORM ok((SELECT duration_minutes FROM reservations WHERE id = r4) = 60, 'existing booking keeps its stored duration');
  rt := pg_temp.bk(a, 2, pg_temp.lt(d0 + 12, '20:00'));
  PERFORM ok((SELECT duration_minutes FROM reservations WHERE id = rt) = 45, 'new booking uses the changed duration');

  -- idempotency, test flag, auto-confirm
  r5 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 13, '19:00'), 'web', 'key-1');
  r6 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 13, '19:00'), 'web', 'key-1');
  PERFORM ok(r5 = r6 AND (SELECT count(*) FROM reservations WHERE idempotency_key = 'key-1') = 1, 'idempotency key prevents duplicates');
  r7 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 14, '19:00'), 'web', NULL, true);
  PERFORM ok(NOT EXISTS (SELECT 1 FROM reservations_live WHERE id = r7), 'is_test bookings are excluded from reservations_live');
  UPDATE reservation_settings SET auto_confirm_enabled = true WHERE location_id = a;
  r1 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 15, '19:00'));
  PERFORM ok((SELECT status FROM reservations WHERE id = r1) = 'confirmed'
             AND (SELECT confirmed_at FROM reservations WHERE id = r1) IS NOT NULL, 'auto-confirm confirms only when enabled');
  UPDATE reservation_settings SET auto_confirm_enabled = false WHERE location_id = a;

  -- history
  r2 := pg_temp.bk(a, 2, pg_temp.lt(d0 + 16, '19:00'));
  UPDATE reservations SET status = 'confirmed' WHERE id = r2;
  PERFORM ok((SELECT count(*) FROM reservation_events WHERE reservation_id = r2) = 2
             AND EXISTS (SELECT 1 FROM reservation_events WHERE reservation_id = r2 AND action = 'status_changed' AND new_status = 'confirmed'),
             'status changes are recorded in the history');

  -- guards
  PERFORM raises('NC903', format('UPDATE reservations SET starts_at = starts_at + interval %L, ends_at = ends_at + interval %L WHERE id = %L', '1 hour', '1 hour', r2),
                 'reservation times cannot be changed without the move operation');
  PERFORM raises('23P01', format('INSERT INTO table_allocations (table_id, kind, during) SELECT table_id, %L, tstzrange(%L, %L) FROM table_allocations WHERE reservation_id = %L LIMIT 1',
                                 'block', pg_temp.lt(d0 + 16, '19:15'), pg_temp.lt(d0 + 16, '19:45'), r2),
                 'database rejects a directly inserted overlapping allocation');
  PERFORM raises('NC903', format('INSERT INTO table_allocations (table_id, reservation_id, kind, during) SELECT id, %L, %L, tstzrange(%L, %L) FROM dining_tables WHERE location_id = %L AND label = %L',
                                 r2, 'reservation', pg_temp.lt(d0 + 20, '19:15'), pg_temp.lt(d0 + 20, '19:20'), a, 'T05'),
                 'an allocation must cover its reservation time');
  PERFORM raises('NC900', 'UPDATE reservation_events SET action = ''x''', 'reservation history cannot be edited');
  PERFORM raises('NC900', 'DELETE FROM reservation_events', 'reservation history cannot be deleted');
  PERFORM raises('NC900', 'TRUNCATE reservation_events CASCADE', 'reservation history cannot be truncated');
  INSERT INTO audit_logs (action, entity_type) VALUES ('test', 'test');
  PERFORM raises('NC900', 'UPDATE audit_logs SET action = ''x''', 'audit log cannot be edited');
  PERFORM raises('NC900', 'DELETE FROM audit_logs', 'audit log cannot be deleted');
  PERFORM raises('NC900', 'UPDATE app_environment SET env = ''production''', 'environment label cannot be changed');

  -- readiness checklist
  PERFORM ok((SELECT ready_for_online_requests FROM reservation_readiness WHERE location_id = a), 'configured location is ready');
  PERFORM ok(NOT (SELECT ready_for_online_requests FROM reservation_readiness WHERE location_id = b), 'unconfigured location is not ready');

  SELECT count(*) INTO n FROM table_allocations WHERE active;
  RAISE NOTICE 'finished: % active allocations existed in this (rolled back) test', n;
END $$;

ROLLBACK;
