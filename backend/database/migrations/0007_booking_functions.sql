-- 0007: reservation logic that must live next to the data so it can be made atomic and tested:
--   opening windows, duration resolution, table availability, booking transaction, readiness checklist.
-- The API (later milestone) calls book_reservation(); it never writes allocations by hand.

CREATE FUNCTION location_tz(p_location uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT timezone FROM locations WHERE id = p_location $$;

-- Opening windows that START on a local date. Special hours replace the weekly hours for that date.
CREATE FUNCTION opening_windows(p_location uuid, p_date date)
RETURNS TABLE (opens_at timestamptz, closes_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH tz AS (SELECT location_tz(p_location) AS name)
  SELECT (p_date + s.opens_at) AT TIME ZONE tz.name,
         ((p_date + CASE WHEN s.closes_next_day THEN 1 ELSE 0 END) + s.closes_at) AT TIME ZONE tz.name
    FROM special_hours s, tz
   WHERE s.location_id = p_location AND s.on_date = p_date AND NOT s.is_closed
  UNION ALL
  SELECT (p_date + h.opens_at) AT TIME ZONE tz.name,
         ((p_date + CASE WHEN h.closes_next_day THEN 1 ELSE 0 END) + h.closes_at) AT TIME ZONE tz.name
    FROM opening_hours h, tz
   WHERE h.location_id = p_location
     AND h.weekday = extract(isodow FROM p_date)::int
     AND NOT EXISTS (SELECT 1 FROM special_hours sp
                      WHERE sp.location_id = p_location AND sp.on_date = p_date)
$$;

-- Is a start time inside opening hours? Looks at windows starting today and yesterday (past-midnight service).
CREATE FUNCTION is_within_opening(p_location uuid, p_start timestamptz, p_last_seating_minutes integer DEFAULT 0)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM generate_series(-1, 0) d(shift),
           LATERAL opening_windows(p_location,
                     ((p_start AT TIME ZONE location_tz(p_location))::date + d.shift)) w
     WHERE p_start >= w.opens_at
       AND p_start <  w.closes_at
       AND p_start <= w.closes_at - make_interval(mins => GREATEST(COALESCE(p_last_seating_minutes, 0), 0))
  )
$$;

-- Duration for a party at a start time. Most specific / highest priority active rule wins.
-- Returns NULL when no rule matches (online booking is then unavailable; nothing is assumed).
CREATE FUNCTION resolve_duration(p_location uuid, p_party integer, p_start timestamptz)
RETURNS integer
LANGUAGE sql STABLE AS $$
  WITH lt AS (SELECT (p_start AT TIME ZONE location_tz(p_location)) AS ts)
  SELECT r.duration_minutes
    FROM duration_rules r, lt
   WHERE r.location_id = p_location AND r.is_active
     AND (r.min_party IS NULL OR p_party >= r.min_party)
     AND (r.max_party IS NULL OR p_party <= r.max_party)
     AND (r.weekdays IS NULL OR extract(isodow FROM lt.ts)::int = ANY (r.weekdays))
     AND (r.start_time IS NULL OR lt.ts::time >= r.start_time)
     AND (r.end_time IS NULL OR lt.ts::time < r.end_time)
   ORDER BY r.priority DESC,
            ((r.min_party IS NOT NULL)::int + (r.max_party IS NOT NULL)::int
             + (r.weekdays IS NOT NULL)::int + (r.start_time IS NOT NULL)::int
             + (r.end_time IS NOT NULL)::int) DESC,
            r.id
   LIMIT 1
$$;

-- Single tables that could take the party in that time range (best fit first).
-- p_online_only = true hides walk-in-only tables (used for web bookings).
CREATE FUNCTION available_tables(p_location uuid, p_party integer, p_during tstzrange,
                                 p_online_only boolean DEFAULT true)
RETURNS TABLE (table_id uuid, label text, max_covers smallint)
LANGUAGE sql STABLE AS $$
  SELECT t.id, t.label, t.max_covers
    FROM dining_tables t
   WHERE t.location_id = p_location AND t.is_active
     AND (NOT p_online_only OR t.online_bookable)
     AND p_party BETWEEN t.min_covers AND t.max_covers
     AND NOT EXISTS (SELECT 1 FROM table_allocations a
                      WHERE a.table_id = t.id AND a.active AND a.during && p_during)
   ORDER BY t.max_covers, t.sort, t.label
$$;

-- Table combinations whose member tables are ALL active, bookable and free in that range.
CREATE FUNCTION available_combinations(p_location uuid, p_party integer, p_during tstzrange,
                                       p_online_only boolean DEFAULT true)
RETURNS TABLE (combination_id uuid, name text, max_covers smallint)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.name, c.max_covers
    FROM table_combinations c
   WHERE c.location_id = p_location AND c.is_active
     AND p_party BETWEEN c.min_covers AND c.max_covers
     AND EXISTS (SELECT 1 FROM table_combination_members m WHERE m.combination_id = c.id)
     AND NOT EXISTS (
           SELECT 1
             FROM table_combination_members m
             JOIN dining_tables t ON t.id = m.table_id
            WHERE m.combination_id = c.id
              AND (NOT t.is_active
                   OR (p_online_only AND NOT t.online_bookable)
                   OR EXISTS (SELECT 1 FROM table_allocations a
                               WHERE a.table_id = t.id AND a.active AND a.during && p_during)))
   ORDER BY c.max_covers, c.name
$$;

-- The booking transaction. Atomic: either the reservation AND its table allocation(s) exist, or nothing does.
--  * refuses when rules are not configured (NC001) - nothing is assumed
--  * picks the best-fitting free table, locking one candidate row at a time with SKIP LOCKED so concurrent
--    requests are steered to different tables
--  * the exclusion constraint on table_allocations is the final safety net: on a conflict the next table is tried
--  * 'web' bookings never use walk-in-only tables; staff bookings may
--  * status is 'confirmed' only for staff bookings or when the owner enabled auto-confirm; otherwise 'pending'
-- Under heavy simultaneous load a request can get NC002 while a table is momentarily held by another in-flight
-- booking; the caller may retry (a booking is never confirmed without a committed allocation).
CREATE FUNCTION book_reservation(
  p_location        uuid,
  p_party           integer,
  p_start           timestamptz,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_notes           text        DEFAULT NULL,
  p_source          text        DEFAULT 'web',
  p_is_test         boolean     DEFAULT false,
  p_consent_at      timestamptz DEFAULT NULL,
  p_idempotency_key text        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  s          reservation_settings%ROWTYPE;
  v_online   boolean := (p_source = 'web');
  v_dur      integer;
  v_end      timestamptz;
  v_range    tstzrange;
  v_local    timestamp;
  v_mins     integer;
  v_res      uuid;
  v_status   text;
  v_tid      uuid;
  v_cid      uuid;
  v_tried    uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_res FROM reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_res; END IF;
  END IF;

  SELECT * INTO s FROM reservation_settings WHERE location_id = p_location;
  IF NOT FOUND OR s.slot_interval_minutes IS NULL THEN
    RAISE EXCEPTION 'Booking rules are not configured (slot interval)' USING ERRCODE = 'NC001';
  END IF;

  v_dur := resolve_duration(p_location, p_party, p_start);
  IF v_dur IS NULL THEN
    RAISE EXCEPTION 'Booking rules are not configured (no duration rule matches)' USING ERRCODE = 'NC001';
  END IF;

  IF v_online AND p_consent_at IS NULL THEN
    RAISE EXCEPTION 'Consent is required for online bookings' USING ERRCODE = 'NC008';
  END IF;

  IF p_party < COALESCE(s.min_party_size, 1)
     OR (v_online AND s.max_online_party_size IS NOT NULL AND p_party > s.max_online_party_size) THEN
    RAISE EXCEPTION 'Party size is not allowed for this booking' USING ERRCODE = 'NC004';
  END IF;

  v_local := p_start AT TIME ZONE location_tz(p_location);
  v_mins  := (extract(hour FROM v_local) * 60 + extract(minute FROM v_local))::integer;
  IF extract(second FROM v_local) <> 0 OR v_mins % s.slot_interval_minutes <> 0 THEN
    RAISE EXCEPTION 'Start time is not on a booking slot' USING ERRCODE = 'NC006';
  END IF;

  IF v_online THEN
    IF s.min_notice_minutes IS NOT NULL AND p_start < now() + make_interval(mins => s.min_notice_minutes) THEN
      RAISE EXCEPTION 'Booking is inside the minimum notice period' USING ERRCODE = 'NC005';
    END IF;
    IF s.max_advance_days IS NOT NULL AND p_start > now() + make_interval(days => s.max_advance_days) THEN
      RAISE EXCEPTION 'Booking is beyond the advance booking limit' USING ERRCODE = 'NC005';
    END IF;
    IF NOT is_within_opening(p_location, p_start, s.last_seating_before_close_minutes) THEN
      RAISE EXCEPTION 'The restaurant is not open for bookings at that time' USING ERRCODE = 'NC007';
    END IF;
  END IF;

  v_end    := p_start + make_interval(mins => v_dur);
  v_range  := tstzrange(p_start, v_end + make_interval(mins => COALESCE(s.turnaround_buffer_minutes, 0)), '[)');
  v_status := CASE WHEN NOT v_online OR s.auto_confirm_enabled THEN 'confirmed' ELSE 'pending' END;

  -- 1) single tables, best fit first, one locked candidate at a time
  LOOP
    SELECT t.id INTO v_tid
      FROM dining_tables t
     WHERE t.location_id = p_location AND t.is_active
       AND (NOT v_online OR t.online_bookable)
       AND p_party BETWEEN t.min_covers AND t.max_covers
       AND t.id <> ALL (v_tried)
       AND NOT EXISTS (SELECT 1 FROM table_allocations a
                        WHERE a.table_id = t.id AND a.active AND a.during && v_range)
     ORDER BY t.max_covers, t.sort, t.label
     LIMIT 1
       FOR UPDATE OF t SKIP LOCKED;
    EXIT WHEN v_tid IS NULL;

    BEGIN
      INSERT INTO reservations (location_id, status, party_size, starts_at, ends_at, duration_minutes,
                                guest_name, guest_email, guest_phone, notes, source, is_test,
                                consent_at, idempotency_key)
      VALUES (p_location, v_status, p_party, p_start, v_end, v_dur,
              p_name, NULLIF(p_email, ''), NULLIF(p_phone, ''), p_notes, p_source, p_is_test,
              p_consent_at, p_idempotency_key)
      RETURNING id INTO v_res;
      INSERT INTO table_allocations (table_id, reservation_id, kind, during)
      VALUES (v_tid, v_res, 'reservation', v_range);
      RETURN v_res;
    EXCEPTION WHEN exclusion_violation THEN
      v_tried := v_tried || v_tid;     -- someone else committed this table first; try the next one
    END;
  END LOOP;

  -- 2) owner-defined table combinations (only when no single table worked)
  v_tried := ARRAY[]::uuid[];
  LOOP
    SELECT c.combination_id INTO v_cid
      FROM available_combinations(p_location, p_party, v_range, v_online) c
     WHERE c.combination_id <> ALL (v_tried)
     LIMIT 1;
    EXIT WHEN v_cid IS NULL;

    BEGIN
      -- lock member tables in a fixed order (avoids deadlocks), then re-verify through the constraint
      PERFORM 1 FROM dining_tables t
        WHERE t.id IN (SELECT table_id FROM table_combination_members WHERE combination_id = v_cid)
        ORDER BY t.id FOR UPDATE;
      INSERT INTO reservations (location_id, status, party_size, starts_at, ends_at, duration_minutes,
                                guest_name, guest_email, guest_phone, notes, source, is_test,
                                consent_at, idempotency_key)
      VALUES (p_location, v_status, p_party, p_start, v_end, v_dur,
              p_name, NULLIF(p_email, ''), NULLIF(p_phone, ''), p_notes, p_source, p_is_test,
              p_consent_at, p_idempotency_key)
      RETURNING id INTO v_res;
      INSERT INTO table_allocations (table_id, reservation_id, kind, during)
      SELECT m.table_id, v_res, 'reservation', v_range
        FROM table_combination_members m WHERE m.combination_id = v_cid;
      RETURN v_res;
    EXCEPTION WHEN exclusion_violation THEN
      v_tried := v_tried || v_cid;
    END;
  END LOOP;

  RAISE EXCEPTION 'No suitable table is available at that time' USING ERRCODE = 'NC002';
END $$;

-- What is still missing before online booking / auto-confirm can be switched on (shown in the dashboard).
CREATE VIEW reservation_readiness AS
SELECT l.id AS location_id,
       l.name,
       EXISTS (SELECT 1 FROM opening_hours h WHERE h.location_id = l.id)                          AS has_opening_hours,
       EXISTS (SELECT 1 FROM dining_tables t WHERE t.location_id = l.id AND t.is_active)           AS has_tables,
       COALESCE(rs.slot_interval_minutes IS NOT NULL, false)                                       AS has_slot_interval,
       EXISTS (SELECT 1 FROM duration_rules d WHERE d.location_id = l.id AND d.is_active)          AS has_duration_rule,
       COALESCE(rs.min_notice_minutes IS NOT NULL AND rs.max_advance_days IS NOT NULL
                AND rs.max_online_party_size IS NOT NULL, false)                                   AS has_booking_limits,
       COALESCE(rs.auto_confirm_enabled, false)                                                    AS auto_confirm_enabled,
       (EXISTS (SELECT 1 FROM opening_hours h WHERE h.location_id = l.id)
        AND EXISTS (SELECT 1 FROM dining_tables t WHERE t.location_id = l.id AND t.is_active AND t.online_bookable)
        AND COALESCE(rs.slot_interval_minutes IS NOT NULL, false)
        AND EXISTS (SELECT 1 FROM duration_rules d WHERE d.location_id = l.id AND d.is_active))     AS ready_for_online_requests,
       (EXISTS (SELECT 1 FROM opening_hours h WHERE h.location_id = l.id)
        AND EXISTS (SELECT 1 FROM dining_tables t WHERE t.location_id = l.id AND t.is_active AND t.online_bookable)
        AND COALESCE(rs.slot_interval_minutes IS NOT NULL, false)
        AND EXISTS (SELECT 1 FROM duration_rules d WHERE d.location_id = l.id AND d.is_active)
        AND COALESCE(rs.min_notice_minutes IS NOT NULL AND rs.max_advance_days IS NOT NULL
                     AND rs.max_online_party_size IS NOT NULL
                     AND rs.turnaround_buffer_minutes IS NOT NULL, false))                         AS ready_for_auto_confirm
  FROM locations l
  LEFT JOIN reservation_settings rs ON rs.location_id = l.id;
