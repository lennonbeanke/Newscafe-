-- 0009: the only doors the API roles have into reservation data.
--   public_available_slots / public_book_reservation   (role newscafe_public)
--   admin_create_reservation / admin_set_reservation_status / admin_edit_reservation / admin_move_reservation
--                                                       (role newscafe_admin)
-- Every SECURITY DEFINER function is owned by newscafe_definer (not a superuser), has a fixed search_path, and is
-- executable only by the role named in its GRANT. Every admin_* function (1) checks the acting owner is a real, active
-- owner account, (2) records them as the actor in the append-only reservation history, and (3) writes the audit_logs
-- row in the SAME transaction as the change, so a change can never exist without its audit entry.
-- The audit log holds field names and non-personal values only; guest names, e-mails, phones and notes are never copied
-- into it (the reservation history from 0005 already holds the full change record).
-- Error codes added here: NC905 idempotency key reused with a different request, NC906 not an active owner,
-- NC907 status change not allowed, NC909 reservation not found. 22023 = invalid input value.

-- ---- small internal helpers (no grants: only called from the functions below) ------------------------------------

-- First aligned slot start at or after a local timestamp. Slots are aligned to the local clock of each day,
-- exactly as book_reservation() checks them (minute of day divisible by the slot interval).
CREATE FUNCTION slot_ceil(p_ts timestamp, p_interval integer) RETURNS timestamp
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_ts = date_trunc('minute', p_ts)
         AND (extract(hour FROM p_ts)::integer * 60 + extract(minute FROM p_ts)::integer) % p_interval = 0
      THEN p_ts
    ELSE (SELECT CASE WHEN x.n * p_interval >= 1440 THEN x.d + interval '1 day'
                      ELSE x.d + make_interval(mins => x.n * p_interval) END
            FROM (SELECT date_trunc('day', p_ts) AS d,
                         (floor((extract(epoch FROM p_ts - date_trunc('day', p_ts)) / 60.0) / p_interval))::integer + 1 AS n) x)
  END
$$;

CREATE FUNCTION audit_write(p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
                            p_before jsonb, p_after jsonb, p_ip_hash text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, ip_hash)
  VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_ip_hash)
$$;

-- Confirms the actor is an active owner and stamps them as the actor for the reservation history.
CREATE FUNCTION admin_begin_action(p_actor uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_actor AND is_active AND role = 'owner') THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = 'NC906';
  END IF;
  PERFORM set_config('app.actor_id', p_actor::text, true);   -- true = this transaction only
END $$;

-- The one active location (News Cafe has a single venue). Anything else means the setup is not finished.
CREATE FUNCTION public_location() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v uuid; n integer;
BEGIN
  SELECT count(*) INTO n FROM locations WHERE is_active;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Exactly one active location is required (found %)', n USING ERRCODE = 'NC001';
  END IF;
  SELECT id INTO v FROM locations WHERE is_active;
  RETURN v;
END $$;

-- Shared input checks for guest details (defence in depth; the API validates first).
CREATE FUNCTION check_guest_input(p_name text, p_email text, p_phone text, p_notes text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Name must be 1-100 characters' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NOT NULL AND p_email <> ''
     AND (char_length(p_email) > 254 OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
    RAISE EXCEPTION 'E-mail address is not valid' USING ERRCODE = '22023';
  END IF;
  IF p_phone IS NOT NULL AND p_phone <> '' AND p_phone !~ '^[0-9+() -]{5,30}$' THEN
    RAISE EXCEPTION 'Phone number is not valid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_email, '') = '' AND COALESCE(p_phone, '') = '' THEN
    RAISE EXCEPTION 'An e-mail address or a phone number is required' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 500 THEN
    RAISE EXCEPTION 'Notes are limited to 500 characters' USING ERRCODE = '22023';
  END IF;
END $$;

-- ---- availability ------------------------------------------------------------------------------------------------

-- Start times a WEB guest could book for a party on a local date. It applies the same rules, in the same order, as
-- book_reservation(); a database test proves every offered slot is bookable and every aligned time not offered is refused.
-- It only reports times, never tables or counts. The booking itself re-checks everything inside its own transaction.
CREATE FUNCTION available_slots(p_location uuid, p_date date, p_party integer)
RETURNS TABLE (slot_start timestamptz)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  s       reservation_settings%ROWTYPE;
  tz      text := location_tz(p_location);
  w       record;
  v_t     timestamp;
  v_start timestamptz;
  v_dur   integer;
  v_range tstzrange;
BEGIN
  SELECT * INTO s FROM reservation_settings WHERE location_id = p_location;
  IF NOT FOUND OR s.slot_interval_minutes IS NULL
     OR NOT EXISTS (SELECT 1 FROM duration_rules d WHERE d.location_id = p_location AND d.is_active) THEN
    RAISE EXCEPTION 'Booking rules are not configured' USING ERRCODE = 'NC001';
  END IF;
  IF p_party IS NULL OR p_party < COALESCE(s.min_party_size, 1)
     OR (s.max_online_party_size IS NOT NULL AND p_party > s.max_online_party_size) THEN
    RAISE EXCEPTION 'Party size is not allowed for this booking' USING ERRCODE = 'NC004';
  END IF;

  FOR w IN SELECT * FROM opening_windows(p_location, p_date) ORDER BY opens_at LOOP
    v_t := slot_ceil(w.opens_at AT TIME ZONE tz, s.slot_interval_minutes);
    LOOP
      v_start := v_t AT TIME ZONE tz;
      EXIT WHEN v_start >= w.closes_at;
      IF (s.min_notice_minutes IS NULL OR v_start >= now() + make_interval(mins => s.min_notice_minutes))
         AND (s.max_advance_days IS NULL OR v_start <= now() + make_interval(days => s.max_advance_days))
         AND is_within_opening(p_location, v_start, s.last_seating_before_close_minutes) THEN
        v_dur := resolve_duration(p_location, p_party, v_start);
        IF v_dur IS NOT NULL THEN
          v_range := tstzrange(v_start,
                               v_start + make_interval(mins => v_dur + COALESCE(s.turnaround_buffer_minutes, 0)), '[)');
          IF EXISTS (SELECT 1 FROM available_tables(p_location, p_party, v_range, true))
             OR EXISTS (SELECT 1 FROM available_combinations(p_location, p_party, v_range, true)) THEN
            slot_start := v_start;
            RETURN NEXT;
          END IF;
        END IF;
      END IF;
      v_t := slot_ceil(v_t + interval '1 second', s.slot_interval_minutes);
    END LOOP;
  END LOOP;
END $$;

-- ---- public endpoints (role newscafe_public) -----------------------------------------------------------------------

CREATE FUNCTION public_available_slots(p_date date, p_party integer)
RETURNS TABLE (slot_start timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_date IS NULL OR p_date < current_date - 1 OR p_date > current_date + 400 THEN
    RAISE EXCEPTION 'Date is outside the range that can be queried' USING ERRCODE = 'NC005';
  END IF;
  RETURN QUERY SELECT a.slot_start FROM available_slots(public_location(), p_date, p_party) a;
END $$;

-- A web booking request. Everything a public client must not control is fixed here: source 'web', never a test
-- booking, consent time = now() (and the caller must assert consent), status decided by the owner's auto-confirm switch.
-- Returns only what the guest already knows plus the reference. A repeated Idempotency-Key with the SAME request returns
-- the original booking; with a DIFFERENT request it is refused (NC905) so a key can never reveal someone else's booking.
CREATE FUNCTION public_book_reservation(p_party integer, p_start timestamptz, p_name text, p_email text, p_phone text,
                                        p_notes text, p_consent boolean, p_idempotency_key text)
RETURNS TABLE (out_reference text, out_status text, out_party_size integer, out_starts_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_loc   uuid := public_location();
  v_name  text := btrim(p_name);
  v_email text := NULLIF(btrim(p_email), '');
  v_phone text := NULLIF(btrim(p_phone), '');
  v_notes text := NULLIF(btrim(p_notes), '');
  v_id    uuid;
  v_try   integer := 0;
  r       reservations%ROWTYPE;
BEGIN
  IF p_consent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Consent is required for online bookings' USING ERRCODE = 'NC008';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  PERFORM check_guest_input(v_name, v_email, v_phone, v_notes);

  LOOP
    v_try := v_try + 1;
    IF v_try > 3 THEN RAISE EXCEPTION 'Could not complete the booking, please try again' USING ERRCODE = 'NC002'; END IF;
    SELECT * INTO r FROM reservations WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF r.party_size = p_party AND r.starts_at = p_start AND r.guest_name = v_name
         AND r.guest_email IS NOT DISTINCT FROM v_email::citext AND r.guest_phone IS NOT DISTINCT FROM v_phone THEN
        RETURN QUERY SELECT r.reference, r.status, r.party_size, r.starts_at;
        RETURN;
      END IF;
      RAISE EXCEPTION 'That idempotency key was already used for a different request' USING ERRCODE = 'NC905';
    END IF;
    BEGIN
      v_id := book_reservation(v_loc, p_party, p_start, v_name, v_email, v_phone, v_notes, 'web', false, now(),
                               p_idempotency_key);
      SELECT * INTO r FROM reservations WHERE id = v_id;
      RETURN QUERY SELECT r.reference, r.status, r.party_size, r.starts_at;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      NULL;   -- the same key was committed by a concurrent identical request: loop and read it back
    END;
  END LOOP;
END $$;

-- ---- admin actions (role newscafe_admin) -------------------------------------------------------------------------------

-- Staff booking (phone / walk-in / admin). Staff may use walk-in-only tables and are not bound by notice or opening
-- hours (same as book_reservation for non-web sources). Confirmed immediately. May be flagged as a test booking.
CREATE FUNCTION admin_create_reservation(p_actor uuid, p_party integer, p_start timestamptz, p_name text, p_email text,
                                         p_phone text, p_notes text, p_source text, p_is_test boolean,
                                         p_idempotency_key text, p_ip_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id    uuid;
  v_name  text := btrim(p_name);
  v_email text := NULLIF(btrim(p_email), '');
  v_phone text := NULLIF(btrim(p_phone), '');
  v_notes text := NULLIF(btrim(p_notes), '');
BEGIN
  PERFORM admin_begin_action(p_actor);
  IF p_source IS NULL OR p_source NOT IN ('phone', 'walk_in', 'admin') THEN
    RAISE EXCEPTION 'Source must be phone, walk_in or admin' USING ERRCODE = '22023';
  END IF;
  PERFORM check_guest_input(v_name, v_email, v_phone, v_notes);
  v_id := book_reservation(public_location(), p_party, p_start, v_name, v_email, v_phone, v_notes, p_source,
                           COALESCE(p_is_test, false), NULL, p_idempotency_key);
  PERFORM audit_write(p_actor, 'reservation.create', 'reservation', v_id::text, NULL,
                      jsonb_build_object('source', p_source, 'party_size', p_party, 'starts_at', p_start,
                                         'is_test', COALESCE(p_is_test, false)), p_ip_hash);
  RETURN v_id;
END $$;

-- Allowed status changes:  pending -> confirmed | cancelled;  confirmed -> cancelled | completed | no_show;
-- reinstate: cancelled -> confirmed (or pending if it was never confirmed);  no_show -> confirmed.  completed is final.
-- Reinstating re-checks the table: if it was taken meanwhile the database refuses (23P01) and nothing changes.
CREATE FUNCTION admin_set_reservation_status(p_actor uuid, p_reservation uuid, p_status text, p_reason text,
                                             p_ip_hash text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r    reservations%ROWTYPE;
  v_ok boolean;
BEGIN
  PERFORM admin_begin_action(p_actor);
  SELECT * INTO r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'NC909'; END IF;
  IF p_reason IS NOT NULL AND char_length(p_reason) > 300 THEN
    RAISE EXCEPTION 'Reason is limited to 300 characters' USING ERRCODE = '22023';
  END IF;
  v_ok := CASE r.status
    WHEN 'pending'   THEN p_status IN ('confirmed', 'cancelled')
    WHEN 'confirmed' THEN p_status IN ('cancelled', 'completed', 'no_show')
    WHEN 'cancelled' THEN p_status = 'confirmed' OR (p_status = 'pending' AND r.confirmed_at IS NULL)
    WHEN 'no_show'   THEN p_status = 'confirmed'
    ELSE false END;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Cannot change a % reservation to %', r.status, p_status USING ERRCODE = 'NC907';
  END IF;
  UPDATE reservations
     SET status        = p_status,
         cancel_reason = CASE WHEN p_status = 'cancelled' THEN NULLIF(btrim(p_reason), '')
                              WHEN r.status IN ('cancelled', 'no_show') THEN NULL ELSE cancel_reason END,
         cancelled_at  = CASE WHEN r.status IN ('cancelled', 'no_show') AND p_status NOT IN ('cancelled', 'no_show')
                              THEN NULL ELSE cancelled_at END
   WHERE id = r.id;
  PERFORM audit_write(p_actor, 'reservation.status', 'reservation', r.id::text,
                      jsonb_build_object('status', r.status), jsonb_build_object('status', p_status), p_ip_hash);
  RETURN p_status;
END $$;

-- Edit contact details / notes only. p_patch may contain: guest_name, guest_email, guest_phone, notes.
-- Times, party size and tables change only through admin_move_reservation().
CREATE FUNCTION admin_edit_reservation(p_actor uuid, p_reservation uuid, p_patch jsonb, p_ip_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r       reservations%ROWTYPE;
  k       text;
  v_name  text;
  v_email text;
  v_phone text;
  v_notes text;
BEGIN
  PERFORM admin_begin_action(p_actor);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('guest_name', 'guest_email', 'guest_phone', 'notes') THEN
      RAISE EXCEPTION 'Field % cannot be edited here', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'NC909'; END IF;
  v_name  := CASE WHEN p_patch ? 'guest_name'  THEN btrim(p_patch ->> 'guest_name')              ELSE r.guest_name END;
  v_email := CASE WHEN p_patch ? 'guest_email' THEN NULLIF(btrim(p_patch ->> 'guest_email'), '') ELSE r.guest_email::text END;
  v_phone := CASE WHEN p_patch ? 'guest_phone' THEN NULLIF(btrim(p_patch ->> 'guest_phone'), '') ELSE r.guest_phone END;
  v_notes := CASE WHEN p_patch ? 'notes'       THEN NULLIF(btrim(p_patch ->> 'notes'), '')       ELSE r.notes END;
  PERFORM check_guest_input(v_name, v_email, v_phone, v_notes);
  UPDATE reservations
     SET guest_name = v_name, guest_email = v_email::citext, guest_phone = v_phone, notes = v_notes
   WHERE id = r.id;
  PERFORM audit_write(p_actor, 'reservation.edit', 'reservation', r.id::text, NULL,
                      jsonb_build_object('fields', (SELECT jsonb_agg(f ORDER BY f) FROM jsonb_object_keys(p_patch) f)),
                      p_ip_hash);
  RETURN r.id;
END $$;

-- ---- moving a reservation (time, party size, duration, table) ------------------------------------------------------------

-- Puts a reservation onto free table(s) for a range. Used only by admin_move_reservation(); staff may use any active table.
-- p_prefer = the tables it had before (kept when still free), p_table = a table the owner picked explicitly.
CREATE FUNCTION allocate_reservation(p_reservation uuid, p_location uuid, p_party integer, p_range tstzrange,
                                     p_prefer uuid[], p_table uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_tid   uuid;
  v_cid   uuid;
  v_tried uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_table IS NOT NULL THEN
    PERFORM 1 FROM dining_tables t
      WHERE t.id = p_table AND t.location_id = p_location AND t.is_active
        AND p_party BETWEEN t.min_covers AND t.max_covers
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That table cannot seat this party' USING ERRCODE = 'NC004';
    END IF;
    BEGIN
      INSERT INTO table_allocations (table_id, reservation_id, kind, during)
      VALUES (p_table, p_reservation, 'reservation', p_range);
      RETURN;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'That table is already taken at that time' USING ERRCODE = 'NC002';
    END;
  END IF;

  -- keep the same single table when it is still free and suitable
  IF p_prefer IS NOT NULL AND cardinality(p_prefer) = 1 THEN
    PERFORM 1 FROM dining_tables t
      WHERE t.id = p_prefer[1] AND t.is_active AND p_party BETWEEN t.min_covers AND t.max_covers
        AND NOT EXISTS (SELECT 1 FROM table_allocations a
                         WHERE a.table_id = t.id AND a.active AND a.during && p_range)
      FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      BEGIN
        INSERT INTO table_allocations (table_id, reservation_id, kind, during)
        VALUES (p_prefer[1], p_reservation, 'reservation', p_range);
        RETURN;
      EXCEPTION WHEN exclusion_violation THEN
        NULL;
      END;
    END IF;
  END IF;

  LOOP   -- best-fitting free single table
    SELECT t.id INTO v_tid
      FROM dining_tables t
     WHERE t.location_id = p_location AND t.is_active
       AND p_party BETWEEN t.min_covers AND t.max_covers
       AND t.id <> ALL (v_tried)
       AND NOT EXISTS (SELECT 1 FROM table_allocations a
                        WHERE a.table_id = t.id AND a.active AND a.during && p_range)
     ORDER BY t.max_covers, t.sort, t.label
     LIMIT 1
       FOR UPDATE OF t SKIP LOCKED;
    EXIT WHEN v_tid IS NULL;
    BEGIN
      INSERT INTO table_allocations (table_id, reservation_id, kind, during)
      VALUES (v_tid, p_reservation, 'reservation', p_range);
      RETURN;
    EXCEPTION WHEN exclusion_violation THEN
      v_tried := v_tried || v_tid;
    END;
  END LOOP;

  v_tried := ARRAY[]::uuid[];
  LOOP   -- owner-defined combinations
    SELECT c.combination_id INTO v_cid
      FROM available_combinations(p_location, p_party, p_range, false) c
     WHERE c.combination_id <> ALL (v_tried)
     LIMIT 1;
    EXIT WHEN v_cid IS NULL;
    BEGIN
      PERFORM 1 FROM dining_tables t
        WHERE t.id IN (SELECT table_id FROM table_combination_members WHERE combination_id = v_cid)
        ORDER BY t.id FOR UPDATE;
      INSERT INTO table_allocations (table_id, reservation_id, kind, during)
      SELECT m.table_id, p_reservation, 'reservation', p_range
        FROM table_combination_members m WHERE m.combination_id = v_cid;
      RETURN;
    EXCEPTION WHEN exclusion_violation THEN
      v_tried := v_tried || v_cid;
    END;
  END LOOP;

  RAISE EXCEPTION 'No suitable table is available at that time' USING ERRCODE = 'NC002';
END $$;

-- Atomic move: either the reservation AND its new table(s) are in place, or (on any error) nothing changed at all.
-- Slot alignment (NC006) and party minimum (NC004) still apply; notice and opening hours do not (staff decision).
-- A changed party size without an explicit duration re-resolves the duration from the owner's rules (a snapshot otherwise).
CREATE FUNCTION admin_move_reservation(p_actor uuid, p_reservation uuid, p_new_start timestamptz, p_new_party integer,
                                       p_duration_minutes integer, p_table_id uuid, p_ip_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r       reservations%ROWTYPE;
  s       reservation_settings%ROWTYPE;
  v_start timestamptz;
  v_party integer;
  v_dur   integer;
  v_end   timestamptz;
  v_range tstzrange;
  v_local timestamp;
  v_mins  integer;
  v_old   uuid[];
  v_old_l text;
  v_new_l text;
BEGIN
  PERFORM admin_begin_action(p_actor);
  SELECT * INTO r FROM reservations WHERE id = p_reservation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'NC909'; END IF;
  IF r.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'A % reservation cannot be moved', r.status USING ERRCODE = 'NC907';
  END IF;
  SELECT * INTO s FROM reservation_settings WHERE location_id = r.location_id;
  IF NOT FOUND OR s.slot_interval_minutes IS NULL THEN
    RAISE EXCEPTION 'Booking rules are not configured (slot interval)' USING ERRCODE = 'NC001';
  END IF;

  v_start := COALESCE(p_new_start, r.starts_at);
  v_party := COALESCE(p_new_party, r.party_size);
  v_dur   := CASE WHEN p_duration_minutes IS NOT NULL THEN p_duration_minutes
                  WHEN v_party <> r.party_size THEN COALESCE(resolve_duration(r.location_id, v_party, v_start), r.duration_minutes)
                  ELSE r.duration_minutes END;
  IF v_dur NOT BETWEEN 15 AND 720 THEN
    RAISE EXCEPTION 'Duration must be 15-720 minutes' USING ERRCODE = '22023';
  END IF;
  IF v_party < COALESCE(s.min_party_size, 1) OR v_party > 999 THEN
    RAISE EXCEPTION 'Party size is not allowed for this booking' USING ERRCODE = 'NC004';
  END IF;
  IF v_start = r.starts_at AND v_party = r.party_size AND v_dur = r.duration_minutes AND p_table_id IS NULL THEN
    RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023';
  END IF;
  v_local := v_start AT TIME ZONE location_tz(r.location_id);
  v_mins  := (extract(hour FROM v_local) * 60 + extract(minute FROM v_local))::integer;
  IF extract(second FROM v_local) <> 0 OR v_mins % s.slot_interval_minutes <> 0 THEN
    RAISE EXCEPTION 'Start time is not on a booking slot' USING ERRCODE = 'NC006';
  END IF;

  v_end   := v_start + make_interval(mins => v_dur);
  v_range := tstzrange(v_start, v_end + make_interval(mins => COALESCE(s.turnaround_buffer_minutes, 0)), '[)');

  SELECT array_agg(a.table_id ORDER BY a.table_id), string_agg(t.label, '+' ORDER BY t.label)
    INTO v_old, v_old_l
    FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id
   WHERE a.reservation_id = r.id AND a.kind = 'reservation' AND a.active;

  PERFORM set_config('app.moving', 'on', true);       -- lets the guard triggers accept this one coordinated change
  DELETE FROM table_allocations WHERE reservation_id = r.id AND kind = 'reservation';
  UPDATE reservations SET starts_at = v_start, ends_at = v_end, party_size = v_party, duration_minutes = v_dur
   WHERE id = r.id;
  PERFORM allocate_reservation(r.id, r.location_id, v_party, v_range, v_old, p_table_id);
  PERFORM set_config('app.moving', 'off', true);

  SELECT string_agg(t.label, '+' ORDER BY t.label) INTO v_new_l
    FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id
   WHERE a.reservation_id = r.id AND a.kind = 'reservation' AND a.active;
  INSERT INTO reservation_events (reservation_id, action, changes)
  VALUES (r.id, 'tables_changed', jsonb_build_object('old', v_old_l, 'new', v_new_l));
  PERFORM audit_write(p_actor, 'reservation.move', 'reservation', r.id::text,
                      jsonb_build_object('starts_at', r.starts_at, 'party_size', r.party_size,
                                         'duration_minutes', r.duration_minutes, 'tables', v_old_l),
                      jsonb_build_object('starts_at', v_start, 'party_size', v_party,
                                         'duration_minutes', v_dur, 'tables', v_new_l), p_ip_hash);
  RETURN r.id;
END $$;

-- ---- ownership, privileges ------------------------------------------------------------------------------------------

ALTER FUNCTION slot_ceil(timestamp, integer) OWNER TO newscafe_definer;
ALTER FUNCTION audit_write(uuid, text, text, text, jsonb, jsonb, text) OWNER TO newscafe_definer;
ALTER FUNCTION admin_begin_action(uuid) OWNER TO newscafe_definer;
ALTER FUNCTION public_location() OWNER TO newscafe_definer;
ALTER FUNCTION check_guest_input(text, text, text, text) OWNER TO newscafe_definer;
ALTER FUNCTION available_slots(uuid, date, integer) OWNER TO newscafe_definer;
ALTER FUNCTION allocate_reservation(uuid, uuid, integer, tstzrange, uuid[], uuid) OWNER TO newscafe_definer;
ALTER FUNCTION public_available_slots(date, integer) OWNER TO newscafe_definer;
ALTER FUNCTION public_book_reservation(integer, timestamptz, text, text, text, text, boolean, text) OWNER TO newscafe_definer;
ALTER FUNCTION admin_create_reservation(uuid, integer, timestamptz, text, text, text, text, text, boolean, text, text) OWNER TO newscafe_definer;
ALTER FUNCTION admin_set_reservation_status(uuid, uuid, text, text, text) OWNER TO newscafe_definer;
ALTER FUNCTION admin_edit_reservation(uuid, uuid, jsonb, text) OWNER TO newscafe_definer;
ALTER FUNCTION admin_move_reservation(uuid, uuid, timestamptz, integer, integer, uuid, text) OWNER TO newscafe_definer;

-- Functions are closed by default (see 0008). Only these grants open a door.
GRANT EXECUTE ON FUNCTION public_available_slots(date, integer) TO newscafe_public;
GRANT EXECUTE ON FUNCTION public_book_reservation(integer, timestamptz, text, text, text, text, boolean, text) TO newscafe_public;
GRANT EXECUTE ON FUNCTION admin_create_reservation(uuid, integer, timestamptz, text, text, text, text, text, boolean, text, text) TO newscafe_admin;
GRANT EXECUTE ON FUNCTION admin_set_reservation_status(uuid, uuid, text, text, text) TO newscafe_admin;
GRANT EXECUTE ON FUNCTION admin_edit_reservation(uuid, uuid, jsonb, text) TO newscafe_admin;
GRANT EXECUTE ON FUNCTION admin_move_reservation(uuid, uuid, timestamptz, integer, integer, uuid, text) TO newscafe_admin;
