-- FAKE DEVELOPMENT DATA ONLY. Every value below is fictional.
-- It refuses to run anywhere except an empty database named 'newscafe_dev' that is labelled 'development'.
-- Opening hours, durations and booking rules here are DEV PLACEHOLDERS to exercise the software.
-- They are NOT News Cafe's real hours or policies: the owner enters those in the admin dashboard.

DO $$
BEGIN
  IF current_database() IS DISTINCT FROM 'newscafe_dev' THEN
    RAISE EXCEPTION 'Seed refused: database is named %, not newscafe_dev', current_database();
  END IF;
  IF app_env() IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'Seed refused: this database is labelled %, not development', app_env();
  END IF;
  IF EXISTS (SELECT 1 FROM locations) THEN
    RAISE EXCEPTION 'Seed refused: database is not empty (use scripts/db-reset.sh)';
  END IF;
END $$;

BEGIN;

INSERT INTO locations (id, name, street, suburb, city, region, postal_code, phone, email)
VALUES ('00000000-0000-4000-8000-000000000001', 'DEV PLACEHOLDER Cafe', '1 Fake Street', 'Faketown',
        'Fakecity', 'Fakeregion', '0000', '+27 00 000 0000', 'info@example.invalid');

INSERT INTO site_settings (location_id, tagline) VALUES
  ('00000000-0000-4000-8000-000000000001', 'DEV PLACEHOLDER tagline');

-- DEV PLACEHOLDER hours: every day 10:00-22:00; Friday and Saturday until midnight.
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at, closes_next_day)
SELECT '00000000-0000-4000-8000-000000000001', d, time '10:00',
       CASE WHEN d IN (5, 6) THEN time '00:00' ELSE time '22:00' END,
       d IN (5, 6)
  FROM generate_series(1, 7) d;

-- DEV PLACEHOLDER rules (not real policy).
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
  max_online_party_size, large_party_threshold, min_notice_minutes, max_advance_days,
  last_seating_before_close_minutes, late_grace_minutes, pending_hold_minutes, auto_confirm_enabled)
VALUES ('00000000-0000-4000-8000-000000000001', 30, 15, 1, 10, 11, 60, 90, 30, 15, 60, false);

INSERT INTO duration_rules (location_id, name, min_party, max_party, duration_minutes, priority) VALUES
  ('00000000-0000-4000-8000-000000000001', 'DEV default', NULL, NULL, 90, 0),
  ('00000000-0000-4000-8000-000000000001', 'DEV small party', 1, 2, 60, 0),
  ('00000000-0000-4000-8000-000000000001', 'DEV large party', 7, NULL, 120, 0);

-- 44 FAKE tables: 20 two-tops, 14 four-tops, 6 six-tops, 4 walk-in-only bar spots.
INSERT INTO dining_tables (location_id, label, section, min_covers, max_covers, online_bookable, sort)
SELECT '00000000-0000-4000-8000-000000000001', 'T' || lpad(n::text, 2, '0'),
       CASE WHEN n <= 20 THEN 'Window' WHEN n <= 34 THEN 'Main' WHEN n <= 40 THEN 'Booths' ELSE 'Bar' END,
       CASE WHEN n <= 20 THEN 1 WHEN n <= 34 THEN 2 WHEN n <= 40 THEN 4 ELSE 1 END,
       CASE WHEN n <= 20 THEN 2 WHEN n <= 34 THEN 4 WHEN n <= 40 THEN 6 ELSE 2 END,
       n <= 40,
       n
  FROM generate_series(1, 44) n;

-- Combinations of neighbouring four-tops (parties of 5-8) and six-tops (parties of 7-12).
INSERT INTO table_combinations (id, location_id, name, min_covers, max_covers) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'T21+T22', 5, 8),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'T23+T24', 5, 8),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000001', 'T35+T36', 7, 12);
INSERT INTO table_combination_members (combination_id, table_id)
SELECT c.id, t.id
  FROM table_combinations c
  JOIN dining_tables t ON t.location_id = c.location_id AND t.label = ANY (string_to_array(c.name, '+'));

-- Fake website content.
INSERT INTO promotions (slug, kind, title, blurb, price_cents, days_of_week, starts_at_time, ends_at_time, status, is_published)
VALUES ('dev-rush-hour', 'promo', 'DEV Rush Hour', 'Fake promotion for development', 6900,
        ARRAY[1,2,3,4,5,6,7]::smallint[], '14:00', '18:00', 'active', true),
       ('dev-orchid-mist', 'promo', 'DEV Orchid Mist', 'Awaiting confirmation (fake)', NULL,
        NULL, NULL, NULL, 'awaiting_confirmation', false);

-- 30 FAKE reservations over the next 7 days, created through the real booking function
-- (staff source, flagged is_test). Names and e-mail addresses are obviously fictional.
DO $$
DECLARE
  i integer;
  v_day date;
  v_start timestamptz;
BEGIN
  FOR i IN 1..30 LOOP
    v_day := current_date + 1 + (i % 7);
    v_start := ((v_day + time '18:00') + ((i % 5) * interval '30 minutes')) AT TIME ZONE 'Africa/Johannesburg';
    PERFORM book_reservation(
      '00000000-0000-4000-8000-000000000001', 2 + (i % 5), v_start,
      'Test Guest ' || lpad(i::text, 3, '0'),
      'test.guest.' || lpad(i::text, 3, '0') || '@example.invalid',
      '+27 00 000 ' || lpad(i::text, 4, '0'),
      'Fake development booking', 'admin', true, now(), NULL);
  END LOOP;
END $$;

INSERT INTO contact_messages (name, surname, email, type, message, is_test, consent_at) VALUES
  ('Test', 'Guest 001', 'test.guest.001@example.invalid', 'Compliment', 'Fake message for development', true, now()),
  ('Test', 'Guest 002', 'test.guest.002@example.invalid', 'Suggestion', 'Fake message for development', true, now());

INSERT INTO function_enquiries (name, company, email, event_date, guests, message, is_test, consent_at) VALUES
  ('Test Guest 003', 'Fake Company', 'test.guest.003@example.invalid', current_date + 45, 40,
   'Fake function enquiry for development', true, now());

COMMIT;
