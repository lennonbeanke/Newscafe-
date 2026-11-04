-- 0005: tables, combinations, reservation rules, reservations, table allocations, history.
-- NOTHING here assumes a duration, capacity, opening hour or rule. Every rule starts empty (NULL)
-- and online booking stays unavailable until the owner configures it (see reservation_readiness).

CREATE TABLE dining_tables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  label           text NOT NULL,
  section         text,
  min_covers      smallint NOT NULL CHECK (min_covers >= 1),
  max_covers      smallint NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,       -- false = disabled (temporarily or permanently)
  online_bookable boolean NOT NULL DEFAULT true,       -- false = walk-in-only table
  notes           text,
  sort            smallint NOT NULL DEFAULT 0,
  UNIQUE (location_id, label),
  CHECK (max_covers >= min_covers)
);

-- Tables the owner allows to be joined for larger parties. Booking one combination blocks every member table.
CREATE TABLE table_combinations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  min_covers  smallint NOT NULL CHECK (min_covers >= 1),
  max_covers  smallint NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (location_id, name),
  CHECK (max_covers >= min_covers)
);
CREATE TABLE table_combination_members (
  combination_id uuid NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id       uuid NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  PRIMARY KEY (combination_id, table_id)
);

-- Booking rules. NULL = not configured yet.
CREATE TABLE reservation_settings (
  location_id                        uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  slot_interval_minutes              integer CHECK (slot_interval_minutes > 0),
  turnaround_buffer_minutes          integer CHECK (turnaround_buffer_minutes >= 0),
  min_party_size                     integer CHECK (min_party_size >= 1),
  max_online_party_size              integer CHECK (max_online_party_size >= 1),
  large_party_threshold              integer CHECK (large_party_threshold >= 1),
  min_notice_minutes                 integer CHECK (min_notice_minutes >= 0),
  max_advance_days                   integer CHECK (max_advance_days >= 1),
  last_seating_before_close_minutes  integer CHECK (last_seating_before_close_minutes >= 0),
  late_grace_minutes                 integer CHECK (late_grace_minutes >= 0),
  pending_hold_minutes               integer CHECK (pending_hold_minutes > 0),
  auto_confirm_enabled               boolean NOT NULL DEFAULT false,
  updated_at                         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER reservation_settings_touch BEFORE UPDATE ON reservation_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Configurable durations. The most specific / highest-priority active rule that matches wins.
-- Rules do not span midnight (start_time < end_time).
CREATE TABLE duration_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  min_party        integer CHECK (min_party >= 1),
  max_party        integer CHECK (max_party >= 1),
  weekdays         smallint[] CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_time       time,
  end_time         time,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  priority         integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  CHECK (max_party IS NULL OR min_party IS NULL OR max_party >= min_party),
  CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time)
);

CREATE TABLE reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE
                   DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  location_id      uuid NOT NULL REFERENCES locations(id),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  party_size       integer NOT NULL CHECK (party_size >= 1),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),   -- snapshot: later rule changes never alter it
  guest_name       text NOT NULL,
  guest_email      citext,
  guest_phone      text,
  notes            text,
  source           text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'phone', 'walk_in', 'admin')),
  is_test          boolean NOT NULL DEFAULT false,
  consent_at       timestamptz,
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  CHECK (ends_at - starts_at = duration_minutes * interval '1 minute'),
  CHECK (guest_email IS NOT NULL OR guest_phone IS NOT NULL)
);
CREATE INDEX reservations_by_time ON reservations (location_id, starts_at);
CREATE INDEX reservations_by_status ON reservations (status, starts_at);

-- THE double-booking guarantee: a table cannot hold two active, overlapping allocations.
-- The range also covers any turnaround buffer. Combined tables get one row per member table.
CREATE TABLE table_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id       uuid NOT NULL REFERENCES dining_tables(id),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'reservation' CHECK (kind IN ('reservation', 'block', 'function')),
  during         tstzrange NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'reservation' OR reservation_id IS NOT NULL),
  CHECK (NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during)),
  CONSTRAINT table_allocations_no_overlap
    EXCLUDE USING gist (table_id WITH =, during WITH &&) WHERE (active)
);
CREATE INDEX table_allocations_by_reservation ON table_allocations (reservation_id);

CREATE TABLE reservation_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES reservations(id),
  at             timestamptz NOT NULL DEFAULT now(),
  actor          text NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.actor_id', true), ''), 'system'),
  action         text NOT NULL,
  old_status     text,
  new_status     text,
  changes        jsonb
);
CREATE INDEX reservation_events_by_reservation ON reservation_events (reservation_id, at);
CREATE TRIGGER reservation_events_append_only
  BEFORE UPDATE OR DELETE ON reservation_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER reservation_events_no_truncate
  BEFORE TRUNCATE ON reservation_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- ---- reservation triggers -------------------------------------------------------------------------

CREATE FUNCTION reservations_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at := now(); END IF;
  ELSE
    IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN NEW.confirmed_at := now(); END IF;
    IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
      NEW.cancelled_at := now();
    END IF;
    -- Times may only change through a move function that sets app.moving (so allocations stay in sync).
    IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
       AND COALESCE(current_setting('app.moving', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Reservation times can only change through the move operation'
        USING ERRCODE = 'NC903';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservations_before BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_before();
CREATE TRIGGER reservations_no_fake_email BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reject_fake_email('guest_email');

CREATE FUNCTION reservations_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO reservation_events (reservation_id, action, new_status)
    VALUES (NEW.id, 'created', NEW.status);
    RETURN NEW;
  END IF;

  SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
    INTO v_changes
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at');

  IF v_changes IS NOT NULL THEN
    INSERT INTO reservation_events (reservation_id, action, old_status, new_status, changes)
    VALUES (NEW.id,
            CASE WHEN NEW.status <> OLD.status THEN 'status_changed' ELSE 'edited' END,
            OLD.status, NEW.status, v_changes);
  END IF;

  -- Cancelled / no-show reservations release their tables immediately; reinstating re-checks the constraint.
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
    UPDATE table_allocations SET active = false
     WHERE reservation_id = NEW.id AND kind = 'reservation' AND active;
  ELSIF NEW.status NOT IN ('cancelled', 'no_show') AND OLD.status IN ('cancelled', 'no_show') THEN
    UPDATE table_allocations SET active = true
     WHERE reservation_id = NEW.id AND kind = 'reservation' AND NOT active;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservations_after AFTER INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_after();

-- A reservation allocation must cover the reservation's own start/end (it may extend further for a buffer).
CREATE FUNCTION table_allocations_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r reservations%ROWTYPE;
BEGIN
  IF NEW.kind = 'reservation'
     AND COALESCE(current_setting('app.moving', true), '') <> 'on' THEN
    SELECT * INTO r FROM reservations WHERE id = NEW.reservation_id;
    IF NOT FOUND OR NOT (NEW.during @> tstzrange(r.starts_at, r.ends_at, '[)')) THEN
      RAISE EXCEPTION 'Allocation must cover the reservation time' USING ERRCODE = 'NC903';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER table_allocations_check BEFORE INSERT OR UPDATE ON table_allocations
  FOR EACH ROW EXECUTE FUNCTION table_allocations_check();

-- Reservations as the dashboard and reports see them (test bookings excluded).
CREATE VIEW reservations_live AS
  SELECT * FROM reservations WHERE NOT is_test;
