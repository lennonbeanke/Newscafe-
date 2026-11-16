-- Availability tests (available_slots / public_available_slots, migration 0009).
-- The key property: the availability list and book_reservation() can never disagree.
--   * every offered slot must be bookable by a web guest, and
--   * every time on the 15-minute (or 10-minute) grid that is NOT offered must be refused by book_reservation().
-- Probes book inside a sub-transaction that is always rolled back. Everything runs in one transaction that is rolled
-- back at the end. All data is fictional. Requires tests/lib.sql.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.lt(d date, t time) RETURNS timestamptz LANGUAGE sql AS
$$ SELECT (d + t) AT TIME ZONE 'Africa/Johannesburg' $$;

-- first date on/after (today + min_days) with the given ISO weekday (1 = Monday)
CREATE FUNCTION pg_temp.dow(p_dow integer, p_min_days integer) RETURNS date LANGUAGE sql AS
$$ SELECT d::date FROM generate_series(current_date + p_min_days, current_date + p_min_days + 6, interval '1 day') d
    WHERE extract(isodow FROM d) = p_dow $$;

-- Would a web booking succeed? Always rolled back.
CREATE FUNCTION pg_temp.probe(p_loc uuid, p_party integer, p_start timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM book_reservation(p_loc, p_party, p_start, 'Probe', 'probe@example.com', '+27000000001', NULL, 'web', true, now(), NULL);
    RAISE EXCEPTION 'probe ok' USING ERRCODE = 'NC999';
  EXCEPTION
    WHEN SQLSTATE 'NC999' THEN RETURN true;
    WHEN OTHERS THEN RETURN false;
  END;
END $$;

-- Both directions of the property for one local calendar day. Returns 'offered/probed'.
CREATE FUNCTION pg_temp.agree(p_loc uuid, p_date date, p_party integer, p_step integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  tz      text := (SELECT timezone FROM locations WHERE id = p_loc);
  offered timestamptz[];
  k       integer;
  t       timestamptz;
  ok_book boolean;
  n_off   integer := 0;
  n_all   integer := 0;
BEGIN
  -- a start time on this local date belongs to a window that began today or yesterday (past-midnight service)
  offered := ARRAY(SELECT slot_start FROM available_slots(p_loc, p_date - 1, p_party)
                   UNION SELECT slot_start FROM available_slots(p_loc, p_date, p_party));
  FOR k IN 0 .. (1440 / p_step) - 1 LOOP
    t := (p_date::timestamp + make_interval(mins => k * p_step)) AT TIME ZONE tz;
    ok_book := pg_temp.probe(p_loc, p_party, t);
    n_all := n_all + 1;
    IF t = ANY (offered) THEN
      n_off := n_off + 1;
      IF NOT ok_book THEN
        RAISE EXCEPTION 'DISAGREE: % party % offered % but a booking is refused', p_loc, p_party, t;
      END IF;
    ELSIF ok_book THEN
      RAISE EXCEPTION 'DISAGREE: % party % NOT offered % but a booking succeeds', p_loc, p_party, t;
    END IF;
  END LOOP;
  RETURN n_off || '/' || n_all;
END $$;

-- ---- venue L1: Mon-Thu 10:00-22:00, Fri-Sat 10:00-02:00 (next day), closed Sunday, last seating 30 min before close ----
INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'L1', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000a2', 'L2 interval 50', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000a3', 'L3 notice', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000a4', 'L4 one table', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000a5', 'L5 unconfigured', '1 Test St', 'T', 'T', 'T', '0000'),
  ('00000000-0000-4000-8000-0000000000a6', 'L6 no duration rule', '1 Test St', 'T', 'T', 'T', '0000');
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at, closes_next_day)
SELECT '00000000-0000-4000-8000-0000000000a1', d, time '10:00', CASE WHEN d IN (5, 6) THEN time '02:00' ELSE time '22:00' END, d IN (5, 6)
  FROM generate_series(1, 6) d;                                    -- no row for Sunday (7): closed
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
    max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
VALUES ('00000000-0000-4000-8000-0000000000a1', 30, 15, 1, 8, 0, 3650, 30);
INSERT INTO duration_rules (location_id, name, min_party, max_party, duration_minutes, priority) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'default', NULL, NULL, 90, 0),
  ('00000000-0000-4000-8000-0000000000a1', 'small', 1, 2, 60, 0);
INSERT INTO dining_tables (id, location_id, label, min_covers, max_covers, online_bookable, sort) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'T1', 1, 2, true, 1),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'T2', 1, 2, true, 2),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a1', 'T3', 2, 4, true, 3),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a1', 'T4', 2, 4, true, 4),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000a1', 'W1', 1, 6, false, 5);
INSERT INTO table_combinations (id, location_id, name, min_covers, max_covers) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'T1+T2', 3, 4);
INSERT INTO table_combination_members (combination_id, table_id) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c2');

-- ---- L2: slot interval 50 (does not divide 1440), 18:00 - 02:00 every day --------------------------------------------
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at, closes_next_day)
SELECT '00000000-0000-4000-8000-0000000000a2', d, time '18:00', time '02:00', true FROM generate_series(1, 7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size, max_online_party_size,
                                  min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
VALUES ('00000000-0000-4000-8000-0000000000a2', 50, 0, 1, 8, 0, 3650, 0);
INSERT INTO duration_rules (location_id, name, duration_minutes) VALUES ('00000000-0000-4000-8000-0000000000a2', 'default', 60);
INSERT INTO dining_tables (location_id, label, min_covers, max_covers) VALUES ('00000000-0000-4000-8000-0000000000a2', 'A', 1, 4);

-- ---- L3: 2 days notice, 5 days advance ----------------------------------------------------------------------------------
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at) SELECT '00000000-0000-4000-8000-0000000000a3', d, time '10:00', time '22:00' FROM generate_series(1, 7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size, max_online_party_size,
                                  min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
VALUES ('00000000-0000-4000-8000-0000000000a3', 30, 0, 1, 8, 2 * 24 * 60, 5, 0);
INSERT INTO duration_rules (location_id, name, duration_minutes) VALUES ('00000000-0000-4000-8000-0000000000a3', 'default', 60);
INSERT INTO dining_tables (location_id, label, min_covers, max_covers) VALUES ('00000000-0000-4000-8000-0000000000a3', 'A', 1, 4);

-- ---- L4: one table, 60 min dining + 15 min turnaround ------------------------------------------------------------------
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at) SELECT '00000000-0000-4000-8000-0000000000a4', d, time '10:00', time '22:00' FROM generate_series(1, 7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size, max_online_party_size,
                                  min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
VALUES ('00000000-0000-4000-8000-0000000000a4', 30, 15, 1, 8, 0, 3650, 0);
INSERT INTO duration_rules (location_id, name, duration_minutes) VALUES ('00000000-0000-4000-8000-0000000000a4', 'default', 60);
INSERT INTO dining_tables (id, location_id, label, min_covers, max_covers) VALUES ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000a4', 'A', 1, 4);

-- ---- L6: settings but no duration rule -------------------------------------------------------------------------------------
INSERT INTO reservation_settings (location_id, slot_interval_minutes) VALUES ('00000000-0000-4000-8000-0000000000a6', 30);

DO $$
DECLARE
  l1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  l2 constant uuid := '00000000-0000-4000-8000-0000000000a2';
  l3 constant uuid := '00000000-0000-4000-8000-0000000000a3';
  l4 constant uuid := '00000000-0000-4000-8000-0000000000a4';
  l5 constant uuid := '00000000-0000-4000-8000-0000000000a5';
  l6 constant uuid := '00000000-0000-4000-8000-0000000000a6';
  mon date := pg_temp.dow(1, 30);  fri date := pg_temp.dow(5, 30);  sat date := pg_temp.dow(6, 30);  sun date := pg_temp.dow(7, 30);
  tzname constant text := 'Africa/Johannesburg';
  s timestamptz[]; n integer; d date; p integer; r text; total_off integer := 0; total_probe integer := 0;
  v_min time; v_max time;
BEGIN
  -- ============ not configured: nothing is assumed ============
  PERFORM raises('NC001', format('SELECT * FROM available_slots(%L, %L, 2)', l5, mon), 'no settings: not configured');
  PERFORM raises('NC001', format('SELECT * FROM available_slots(%L, %L, 2)', l6, mon), 'no duration rule: not configured');
  PERFORM raises('NC004', format('SELECT * FROM available_slots(%L, %L, 0)', l1, mon), 'party of 0 refused');
  PERFORM raises('NC004', format('SELECT * FROM available_slots(%L, %L, 9)', l1, mon), 'party above the online maximum refused');
  PERFORM raises('NC004', format('SELECT * FROM available_slots(%L, %L, NULL)', l1, mon), 'party NULL refused');

  -- ============ opening hours ============
  s := ARRAY(SELECT slot_start FROM available_slots(l1, mon, 2) ORDER BY 1);
  PERFORM ok(s[1] = pg_temp.lt(mon, '10:00'), 'first slot is the opening time');
  PERFORM ok(s[array_upper(s, 1)] = pg_temp.lt(mon, '21:30'), 'last slot respects the 30 minute last-seating rule (21:30)');
  PERFORM ok(array_length(s, 1) = 24, '10:00 to 21:30 every 30 minutes = 24 slots');
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l1, sun, 2)), 1) IS NULL, 'a day without opening hours has no slots (Sunday)');
  s := ARRAY(SELECT slot_start FROM available_slots(l1, fri, 2) ORDER BY 1);
  PERFORM ok(s[array_upper(s, 1)] = pg_temp.lt(fri + 1, '01:30'), 'Friday service runs past midnight; last slot 01:30 the next morning');
  PERFORM ok(pg_temp.lt(fri + 1, '00:00') = ANY (s) AND pg_temp.lt(fri + 1, '00:30') = ANY (s), 'slots after midnight are included');
  PERFORM ok(pg_temp.lt(fri + 1, '02:00') <> ALL (s), 'the closing time itself is never offered');
  -- special hours
  INSERT INTO special_hours (location_id, on_date, is_closed, label) VALUES (l1, mon, true, 'closed for a private event');
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l1, mon, 2)), 1) IS NULL, 'a closed special day has no slots');
  DELETE FROM special_hours WHERE location_id = l1 AND on_date = mon;
  INSERT INTO special_hours (location_id, on_date, is_closed, opens_at, closes_at, label) VALUES (l1, mon, false, time '12:00', time '15:00', 'short day');
  s := ARRAY(SELECT slot_start FROM available_slots(l1, mon, 2) ORDER BY 1);
  PERFORM ok(s[1] = pg_temp.lt(mon, '12:00') AND s[array_upper(s, 1)] = pg_temp.lt(mon, '14:30'), 'special hours replace the weekly hours (12:00-14:30)');
  DELETE FROM special_hours WHERE location_id = l1 AND on_date = mon;

  -- ============ a slot interval that does not divide the day (50 minutes) ============
  s := ARRAY(SELECT slot_start FROM available_slots(l2, mon, 2) ORDER BY 1);
  PERFORM ok(s[1] = pg_temp.lt(mon, '18:20'), '50 minute grid: the first slot at or after 18:00 is 18:20 (minute 1100 = 22 x 50)');
  PERFORM ok(pg_temp.lt(mon + 1, '00:00') = ANY (s), '50 minute grid realigns at midnight (00:00 is a slot)');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM unnest(s) x
                          WHERE ((extract(hour FROM x AT TIME ZONE tzname) * 60 + extract(minute FROM x AT TIME ZONE tzname))::int) % 50 <> 0),
             'every offered slot sits on the local 50 minute grid');

  -- ============ notice and advance window ============
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l3, current_date, 2)), 1) IS NULL, '2 days notice: today has no slots');
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l3, current_date + 1, 2)), 1) IS NULL, '2 days notice: tomorrow has no slots');
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l3, current_date + 4, 2)), 1) > 0, 'a date inside the window has slots');
  PERFORM ok(array_length(ARRAY(SELECT slot_start FROM available_slots(l3, current_date + 9, 2)), 1) IS NULL, '5 days advance limit: day 9 has no slots');

  -- ============ one table, turnaround buffer ============
  PERFORM book_reservation(l4, 2, pg_temp.lt(mon, '19:00'), 'Held', 'h@example.com', NULL, NULL, 'phone', false, NULL, NULL);
  s := ARRAY(SELECT slot_start FROM available_slots(l4, mon, 2));
  PERFORM ok(pg_temp.lt(mon, '17:30') = ANY (s), '17:30 is offered (ends 18:30 + 15 min turnaround before 19:00)');
  PERFORM ok(pg_temp.lt(mon, '18:00') <> ALL (s), '18:00 is not offered (its 60 min + 15 min turnaround would overlap 19:00)');
  PERFORM ok(pg_temp.lt(mon, '19:30') <> ALL (s) AND pg_temp.lt(mon, '20:00') <> ALL (s), '19:30 and 20:00 are not offered (the table is held until 20:15)');
  PERFORM ok(pg_temp.lt(mon, '20:30') = ANY (s), '20:30 is offered again');

  -- ============ the public wrapper reports the same slots (it works only for a single active venue) ============
  UPDATE locations SET is_active = false WHERE id <> l1;
  PERFORM ok(ARRAY(SELECT slot_start FROM public_available_slots(mon, 2) ORDER BY 1) = ARRAY(SELECT slot_start FROM available_slots(l1, mon, 2) ORDER BY 1)
             AND array_length(ARRAY(SELECT slot_start FROM public_available_slots(mon, 2)), 1) = 24,
             'public_available_slots returns exactly the venue''s slots');
  UPDATE locations SET is_active = true WHERE id <> l1;

  -- ============ availability and booking never disagree (L1, all tables free) ============
  FOR p IN 1 .. 6 LOOP
    FOR d IN SELECT g::date FROM generate_series(mon, mon + 7, interval '1 day') g LOOP
      r := pg_temp.agree(l1, d, p, 15);
      total_off := total_off + split_part(r, '/', 1)::int;  total_probe := total_probe + split_part(r, '/', 2)::int;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'ok - L1 free: % offered slots / % probed times, availability and booking agree on every one (parties 1-6, 8 days)', total_off, total_probe;
  PERFORM ok(total_off > 400, 'the agreement test really exercised many offered slots (' || total_off || ')');

  -- ============ combinations: party of 3 uses T3/T4 or the T1+T2 combination ============
  PERFORM book_reservation(l1, 3, pg_temp.lt(mon, '19:00'), 'F1', 'f1@example.com', NULL, NULL, 'phone', false, NULL, NULL);    -- T3
  PERFORM book_reservation(l1, 3, pg_temp.lt(mon, '19:00'), 'F2', 'f2@example.com', NULL, NULL, 'phone', false, NULL, NULL);    -- T4
  PERFORM ok(pg_temp.lt(mon, '19:00') = ANY (ARRAY(SELECT slot_start FROM available_slots(l1, mon, 3))), 'party of 3 at 19:00 is still offered through the T1+T2 combination');
  PERFORM book_reservation(l1, 1, pg_temp.lt(mon, '19:00'), 'F3', 'f3@example.com', NULL, NULL, 'phone', false, NULL, NULL);    -- T1
  PERFORM ok(pg_temp.lt(mon, '19:00') <> ALL (ARRAY(SELECT slot_start FROM available_slots(l1, mon, 3))), 'once T1 is taken the combination is gone and 19:00 is no longer offered for 3');
  PERFORM ok(pg_temp.lt(mon, '19:00') = ANY (ARRAY(SELECT slot_start FROM available_slots(l1, mon, 1))), 'party of 1 at 19:00 is still offered (T2 is free)');
  -- same property with a partly full evening
  total_off := 0; total_probe := 0;
  FOR p IN 1 .. 5 LOOP
    r := pg_temp.agree(l1, mon, p, 15);
    total_off := total_off + split_part(r, '/', 1)::int;  total_probe := total_probe + split_part(r, '/', 2)::int;
  END LOOP;
  RAISE NOTICE 'ok - L1 partly full: % offered / % probed, availability and booking agree', total_off, total_probe;
  -- fill every online table at 17:00 and check again
  FOR n IN 1 .. 4 LOOP
    PERFORM book_reservation(l1, 2, pg_temp.lt(mon, '17:00'), 'G' || n, 'g' || n || '@example.com', NULL, NULL, 'phone', false, NULL, NULL);
  END LOOP;
  PERFORM ok(pg_temp.lt(mon, '17:00') <> ALL (ARRAY(SELECT slot_start FROM available_slots(l1, mon, 2))), 'with every online table taken, 17:00 is not offered');
  PERFORM ok(pg_temp.lt(mon, '17:00') <> ALL (ARRAY(SELECT slot_start FROM available_slots(l1, mon, 1))), '...nor for a party of 1 (the walk-in-only table is never offered online)');
  total_off := 0;
  FOR p IN 1 .. 4 LOOP
    r := pg_temp.agree(l1, mon, p, 15);
    total_off := total_off + split_part(r, '/', 1)::int;
  END LOOP;
  RAISE NOTICE 'ok - L1 busy evening: availability and booking agree (% offered)', total_off;

  -- ============ past-midnight and the 50 minute grid agree with booking ============
  total_off := 0; total_probe := 0;
  FOR d IN SELECT g::date FROM generate_series(fri - 1, fri + 2, interval '1 day') g LOOP
    r := pg_temp.agree(l1, d, 2, 15);
    total_off := total_off + split_part(r, '/', 1)::int;  total_probe := total_probe + split_part(r, '/', 2)::int;
  END LOOP;
  RAISE NOTICE 'ok - L1 Friday/Saturday past-midnight service: % offered / % probed, agree', total_off, total_probe;
  total_off := 0; total_probe := 0;
  FOR d IN SELECT g::date FROM generate_series(mon, mon + 2, interval '1 day') g LOOP
    r := pg_temp.agree(l2, d, 2, 10);
    total_off := total_off + split_part(r, '/', 1)::int;  total_probe := total_probe + split_part(r, '/', 2)::int;
  END LOOP;
  RAISE NOTICE 'ok - L2 (50 minute grid, past midnight): % offered / % probed, agree', total_off, total_probe;
  PERFORM ok(total_off >= 30, 'the 50 minute grid test exercised ' || total_off || ' offered slots');

  RAISE NOTICE 'finished: availability tests complete (transaction is rolled back)';
END $$;

ROLLBACK;
