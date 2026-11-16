-- Privilege, ownership and admin-action tests for the API roles (migrations 0008 + 0009).
-- Runs in a throw-away database inside one transaction that is rolled back. All data is fictional.
-- Requires tests/lib.sql (ok / raises / raises_as / scalar_as / works_as).
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.lt(d date, t time) RETURNS timestamptz LANGUAGE sql AS
$$ SELECT (d + t) AT TIME ZONE 'Africa/Johannesburg' $$;

-- SQL text builders (executed later AS a role)
CREATE FUNCTION pg_temp.pb(p_party integer, p_start timestamptz, p_key text, p_consent boolean DEFAULT true,
                           p_email text DEFAULT 'guest@example.com', p_phone text DEFAULT '+27000000000',
                           p_name text DEFAULT 'Test Guest', p_notes text DEFAULT NULL) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT out_reference FROM public_book_reservation(%s,%L,%L,%L,%L,%L,%L,%L)',
                 p_party, p_start, p_name, p_email, p_phone, p_notes, p_consent, p_key) $$;

CREATE FUNCTION pg_temp.ac(p_actor uuid, p_party integer, p_start timestamptz, p_key text DEFAULT NULL,
                           p_src text DEFAULT 'phone', p_name text DEFAULT 'Staff Guest',
                           p_test boolean DEFAULT false) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT admin_create_reservation(%L,%s,%L,%L,%L,%L,NULL,%L,%L,%L,%L)',
                 p_actor, p_party, p_start, p_name, 'staff@example.com', '+27111111111', p_src, p_test, p_key, 'iphash1') $$;

CREATE FUNCTION pg_temp.st(p_actor uuid, p_res uuid, p_status text, p_reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT admin_set_reservation_status(%L,%L,%L,%L,%L)', p_actor, p_res, p_status, p_reason, 'iphash1') $$;

CREATE FUNCTION pg_temp.mv(p_actor uuid, p_res uuid, p_start timestamptz DEFAULT NULL, p_party integer DEFAULT NULL,
                           p_dur integer DEFAULT NULL, p_table uuid DEFAULT NULL) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT admin_move_reservation(%L,%L,%L,%L,%L,%L,%L)', p_actor, p_res, p_start, p_party, p_dur, p_table, 'iphash1') $$;

CREATE FUNCTION pg_temp.ed(p_actor uuid, p_res uuid, p_patch text) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT admin_edit_reservation(%L,%L,%L::jsonb,%L)', p_actor, p_res, p_patch, 'iphash1') $$;

CREATE FUNCTION pg_temp.lbl(p_res uuid) RETURNS text LANGUAGE sql AS
$$ SELECT string_agg(t.label, '+' ORDER BY t.label)
     FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id
    WHERE a.reservation_id = p_res AND a.active $$;

-- ---- fictional venue ---------------------------------------------------------------------------------------------
INSERT INTO locations (id, name, street, suburb, city, region, postal_code) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'TEST VENUE', '1 Test St', 'T', 'T', 'T', '0000');
INSERT INTO opening_hours (location_id, weekday, opens_at, closes_at)
SELECT '00000000-0000-4000-8000-0000000000a1', d, time '10:00', time '22:00' FROM generate_series(1, 7) d;
INSERT INTO reservation_settings (location_id, slot_interval_minutes, turnaround_buffer_minutes, min_party_size,
    max_online_party_size, min_notice_minutes, max_advance_days, last_seating_before_close_minutes)
VALUES ('00000000-0000-4000-8000-0000000000a1', 30, 15, 1, 10, 0, 3650, 0);
INSERT INTO duration_rules (location_id, name, min_party, max_party, duration_minutes, priority) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'default', NULL, NULL, 90, 0),
  ('00000000-0000-4000-8000-0000000000a1', 'small', 1, 2, 60, 0);
INSERT INTO dining_tables (id, location_id, label, min_covers, max_covers, online_bookable, sort) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'T1', 1, 2, true, 1),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'T2', 1, 2, true, 2),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a1', 'T3', 2, 4, true, 3),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a1', 'W1', 1, 4, false, 4);
INSERT INTO admin_users (id, email, password_hash, role, is_active) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'owner@example.invalid',    'not-a-real-hash', 'owner',   true),
  ('00000000-0000-4000-8000-0000000000d2', 'manager@example.invalid',  'not-a-real-hash', 'manager', true),
  ('00000000-0000-4000-8000-0000000000d3', 'retired@example.invalid',  'not-a-real-hash', 'owner',   false);

DO $$
DECLARE
  own  constant uuid := '00000000-0000-4000-8000-0000000000d1';
  mgr  constant uuid := '00000000-0000-4000-8000-0000000000d2';
  dead constant uuid := '00000000-0000-4000-8000-0000000000d3';
  t1   constant uuid := '00000000-0000-4000-8000-0000000000c1';
  t2   constant uuid := '00000000-0000-4000-8000-0000000000c2';
  t3   constant uuid := '00000000-0000-4000-8000-0000000000c3';
  loc  constant uuid := '00000000-0000-4000-8000-0000000000a1';
  dA date := current_date + 30;  dB date := current_date + 31;  dC date := current_date + 32;
  dD date := current_date + 33;  dE date := current_date + 34;
  tbl text; fn text;
  ref1 text; rid uuid; ra uuid; rb uuid; m1 uuid; n integer; ev integer; v text;
BEGIN
  -- ================= roles themselves =================
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('newscafe_definer', 'newscafe_public', 'newscafe_admin')
                           AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)),
             'API roles are not superuser / createdb / createrole / replication / bypassrls');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
                          WHERE r.rolname IN ('newscafe_definer', 'newscafe_public', 'newscafe_admin')),
             'API roles are not members of any other role (no hidden privileges)');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                           AND p.proowner <> 'newscafe_definer'::regrole),
             'every SECURITY DEFINER function is owned by newscafe_definer, not a superuser');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                           AND NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, public'], false)),
             'every SECURITY DEFINER function has a fixed search_path');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
                           AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))),
             'no SECURITY DEFINER function is executable by PUBLIC');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                           AND p.proname IN ('book_reservation', 'available_tables', 'available_combinations', 'available_slots',
                                             'allocate_reservation', 'audit_write', 'admin_begin_action', 'public_location')
                           AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                                             WHERE a.grantee IN (0::oid, 'newscafe_public'::regrole::oid, 'newscafe_admin'::regrole::oid)))),
             'internal booking functions are closed to PUBLIC and to both API roles');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(d.datacl) a
                          WHERE d.datname = current_database() AND a.grantee = 0),
             'PUBLIC cannot connect to the database');
  PERFORM ok(has_database_privilege('newscafe_public', current_database(), 'CONNECT')
             AND has_database_privilege('newscafe_admin', current_database(), 'CONNECT'), 'API roles can connect');
  PERFORM ok((SELECT setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
               WHERE r.rolname = 'newscafe_public' AND s.setdatabase = 0) @> ARRAY['statement_timeout=5s'],
             'public role has a 5 s statement timeout');
  -- (switching to another role is refused for a real login as these roles; that is tested with real connections in the API suite,
  --  because this test session is the superuser and may SET ROLE to anything)
  PERFORM ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'public_book_reservation'
                           AND proargnames && ARRAY['p_source', 'p_is_test', 'p_status', 'p_consent_at', 'p_location']),
             'public booking has no source / test / status / consent-time / location parameter to forge');

  -- ================= public role: no table access at all =================
  FOREACH tbl IN ARRAY ARRAY['reservations', 'admin_users', 'admin_sessions', 'audit_logs', 'locations', 'dining_tables',
                             'reservation_events', 'table_allocations', 'reservation_settings', 'login_attempts',
                             'contact_messages', 'function_enquiries', 'admin_recovery_codes', 'idempotency_keys']
  LOOP
    PERFORM raises_as('newscafe_public', '42501', 'SELECT count(*) FROM ' || tbl, 'public role cannot read ' || tbl);
  END LOOP;
  PERFORM raises_as('newscafe_public', '42501', 'SELECT * FROM reservation_readiness', 'public role cannot read the readiness view');
  PERFORM raises_as('newscafe_public', '42501', 'SELECT * FROM reservations_live', 'public role cannot read reservations_live');
  PERFORM raises_as('newscafe_public', '42501',
                    $q$INSERT INTO reservations (location_id, party_size, starts_at, ends_at, duration_minutes, guest_name, guest_phone)
                       VALUES ('00000000-0000-4000-8000-0000000000a1', 2, now() + interval '3 days', now() + interval '3 days 1 hour', 60, 'X', '+27000000000')$q$,
                    'public role cannot insert reservations directly');
  PERFORM raises_as('newscafe_public', '42501', 'DELETE FROM table_allocations', 'public role cannot delete allocations');
  PERFORM raises_as('newscafe_public', '42501', 'UPDATE reservations SET status = ''confirmed''', 'public role cannot confirm reservations');
  FOREACH fn IN ARRAY ARRAY[
      $q$SELECT book_reservation('00000000-0000-4000-8000-0000000000a1', 2, now(), 'X', 'x@example.com', NULL)$q$,
      $q$SELECT * FROM available_slots('00000000-0000-4000-8000-0000000000a1', current_date, 2)$q$,
      $q$SELECT * FROM available_tables('00000000-0000-4000-8000-0000000000a1', 2, tstzrange(now(), now() + interval '1 hour'))$q$,
      $q$SELECT admin_set_reservation_status(NULL, NULL, 'confirmed', NULL, NULL)$q$,
      $q$SELECT admin_begin_action('00000000-0000-4000-8000-0000000000d1')$q$,
      $q$SELECT audit_write(NULL, 'x', 'x', 'x', NULL, NULL, NULL)$q$,
      $q$SELECT public_location()$q$]
  LOOP
    PERFORM raises_as('newscafe_public', '42501', fn, 'public role cannot call ' || split_part(substr(fn, 8), '(', 1));
  END LOOP;

  -- ================= public booking: what it can and cannot do =================
  PERFORM ok((SELECT count(*) FROM public_available_slots(dA, 2)) > 0, 'availability offers slots (superuser view)');
  PERFORM ok(scalar_as('newscafe_public', format('SELECT count(*) FROM public_available_slots(%L, 2)', dA))::int > 0,
             'public role can read availability');
  PERFORM ok(scalar_as('newscafe_public', 'SELECT public_environment()') = 'development', 'public role can read the environment label (and nothing else) through public_environment()');
  PERFORM ok(scalar_as('newscafe_admin', 'SELECT public_environment()') = 'development', 'admin role can too');
  ref1 := scalar_as('newscafe_public', pg_temp.pb(2, pg_temp.lt(dA, '19:00'), 'public-key-aaaaaaaaaaaa1', true,
                                                  'guest@example.com', '+27000000000', 'Test Guest', 'window seat'));
  PERFORM ok(ref1 ~ '^[0-9A-F]{8}$', 'public booking returns a reference');
  SELECT * INTO rid, v FROM (SELECT id, status FROM reservations WHERE reference = ref1) x;
  PERFORM ok(v = 'pending', 'web booking is pending (auto-confirm is off)');
  PERFORM ok((SELECT source = 'web' AND NOT is_test AND consent_at IS NOT NULL AND notes = 'window seat'
                FROM reservations WHERE id = rid), 'source is web, not a test booking, consent time recorded by the database');
  PERFORM ok(scalar_as('newscafe_public', pg_temp.pb(2, pg_temp.lt(dA, '19:00'), 'public-key-aaaaaaaaaaaa1', true,
                                                     'guest@example.com', '+27000000000', 'Test Guest', 'window seat')) = ref1
             AND (SELECT count(*) FROM reservations WHERE idempotency_key = 'public-key-aaaaaaaaaaaa1') = 1,
             'repeating the same request with the same key returns the same booking (one row)');
  PERFORM raises_as('newscafe_public', 'NC905', pg_temp.pb(3, pg_temp.lt(dA, '19:00'), 'public-key-aaaaaaaaaaaa1'),
                    'the same key with a different request is refused');
  PERFORM raises_as('newscafe_public', 'NC905', pg_temp.pb(2, pg_temp.lt(dA, '19:00'), 'public-key-aaaaaaaaaaaa1', true, 'other@example.com'),
                    'the same key with a different e-mail is refused (a key cannot reveal another guest''s booking)');
  PERFORM raises_as('newscafe_public', 'NC008', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa2', false), 'consent false is refused');
  PERFORM raises_as('newscafe_public', 'NC008', format('SELECT * FROM public_book_reservation(2,%L,%L,%L,%L,NULL,NULL,%L)',
                    pg_temp.lt(dA, '20:00'), 'G', 'g@example.com', '+27000000000', 'public-key-aaaaaaaaaaaa3'), 'consent NULL is refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa4', true, 'not-an-email'), 'invalid e-mail refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa5', true, 'g@example.com', 'abc-phone'), 'invalid phone refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa6', true, 'g@example.com', '+27000000000', ''), 'empty name refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa7', true, 'g@example.com', '+27000000000', repeat('n', 101)), 'name over 100 characters refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa8', true, 'g@example.com', '+27000000000', 'G', repeat('x', 501)), 'notes over 500 characters refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'short'), 'short idempotency key refused');
  PERFORM raises_as('newscafe_public', '22023', pg_temp.pb(2, pg_temp.lt(dA, '20:00'), 'public-key-aaaaaaaaaaaa9', true, NULL, NULL), 'booking with no e-mail and no phone refused');
  -- hostile text is just data
  v := scalar_as('newscafe_public', pg_temp.pb(1, pg_temp.lt(dA, '12:00'), 'public-key-injection-0001', true, 'g@example.com', '+27000000000',
                                               $n$Robert'); DROP TABLE reservations;--$n$, $n$<script>alert(1)</script>$n$));
  PERFORM ok((SELECT guest_name FROM reservations WHERE reference = v) = $n$Robert'); DROP TABLE reservations;--$n$
             AND (SELECT notes FROM reservations WHERE reference = v) = '<script>alert(1)</script>',
             'SQL-injection and script text are stored as plain data; nothing is executed');
  -- web bookings never use the walk-in-only table: fill the three online tables, the next request is refused
  PERFORM scalar_as('newscafe_public', pg_temp.pb(2, pg_temp.lt(dA, '15:00'), 'public-key-fill-000000001'));
  PERFORM scalar_as('newscafe_public', pg_temp.pb(2, pg_temp.lt(dA, '15:00'), 'public-key-fill-000000002'));
  PERFORM scalar_as('newscafe_public', pg_temp.pb(2, pg_temp.lt(dA, '15:00'), 'public-key-fill-000000003'));
  PERFORM raises_as('newscafe_public', 'NC002', pg_temp.pb(2, pg_temp.lt(dA, '15:00'), 'public-key-fill-000000004'),
                    'a fourth web booking is refused although the walk-in-only table is free');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id WHERE t.label = 'W1'),
             'the walk-in-only table was never allocated to a web booking');
  PERFORM raises_as('newscafe_public', 'NC005', format('SELECT * FROM public_available_slots(%L, 2)', current_date + 5000), 'availability date range is limited');
  INSERT INTO locations (id, name, street, suburb, city, region, postal_code)
    VALUES ('00000000-0000-4000-8000-0000000000a2', 'SECOND', '1', 'T', 'T', 'T', '0');
  PERFORM raises_as('newscafe_public', 'NC001', pg_temp.pb(2, pg_temp.lt(dA, '19:00'), 'public-key-twoloc-00001'),
                    'two active locations is a setup problem: refused');
  DELETE FROM locations WHERE id = '00000000-0000-4000-8000-0000000000a2';

  -- ================= admin role: reads yes, direct writes no =================
  PERFORM works_as('newscafe_admin', 'SELECT count(*) FROM reservations', 'admin role can read reservations');
  PERFORM works_as('newscafe_admin', 'SELECT * FROM reservation_readiness', 'admin role can read the readiness view');
  FOREACH fn IN ARRAY ARRAY[
      $q$INSERT INTO reservations (location_id, party_size, starts_at, ends_at, duration_minutes, guest_name, guest_phone) VALUES ('00000000-0000-4000-8000-0000000000a1', 2, now() + interval '3 days', now() + interval '3 days 1 hour', 60, 'X', '+27000000000')$q$,
      $q$UPDATE reservations SET status = 'confirmed'$q$,
      $q$UPDATE reservations SET starts_at = starts_at + interval '1 hour'$q$,
      $q$DELETE FROM reservations$q$,
      $q$INSERT INTO table_allocations (table_id, kind, during) VALUES ('00000000-0000-4000-8000-0000000000c1', 'block', tstzrange(now(), now() + interval '1 hour'))$q$,
      $q$DELETE FROM table_allocations$q$,
      $q$UPDATE table_allocations SET active = false$q$,
      $q$INSERT INTO reservation_events (reservation_id, action) SELECT id, 'forged' FROM reservations LIMIT 1$q$,
      $q$UPDATE audit_logs SET action = 'tampered'$q$,
      $q$DELETE FROM audit_logs$q$,
      $q$TRUNCATE audit_logs$q$,
      $q$TRUNCATE reservation_events$q$,
      $q$INSERT INTO admin_users (email, password_hash, role) VALUES ('new-owner@example.invalid', 'x', 'owner')$q$,
      $q$UPDATE admin_users SET role = 'owner'$q$,
      $q$UPDATE admin_users SET is_active = true$q$,
      $q$UPDATE admin_users SET email = 'someone@example.invalid'$q$,
      $q$DELETE FROM admin_users$q$,
      $q$DELETE FROM admin_sessions$q$,
      $q$UPDATE locations SET name = 'x'$q$,
      $q$INSERT INTO dining_tables (location_id, label, min_covers, max_covers) VALUES ('00000000-0000-4000-8000-0000000000a1', 'X', 1, 2)$q$,
      $q$UPDATE reservation_settings SET auto_confirm_enabled = true$q$,
      $q$UPDATE app_environment SET env = 'production'$q$,
      $q$CREATE TABLE sneaky (id int)$q$,
      $q$SELECT public_book_reservation(2, now(), 'X', 'x@example.com', NULL, NULL, true, 'admin-key-aaaaaaaaaaaaaa')$q$,
      $q$SELECT book_reservation('00000000-0000-4000-8000-0000000000a1', 2, now(), 'X', 'x@example.com', NULL)$q$,
      $q$SELECT admin_begin_action('00000000-0000-4000-8000-0000000000d1')$q$]
  LOOP
    PERFORM raises_as('newscafe_admin', '42501', fn, 'admin role is refused: ' || left(regexp_replace(fn, '\s+', ' ', 'g'), 52));
  END LOOP;
  -- what the admin role legitimately writes for login handling
  PERFORM works_as('newscafe_admin', format($q$INSERT INTO audit_logs (actor_id, action, entity_type) VALUES (%L, 'auth.login', 'admin_user')$q$, own), 'admin role can append to the audit log');
  PERFORM works_as('newscafe_admin', $q$INSERT INTO login_attempts (key_hash, success) VALUES ('hmac-aaaa', false)$q$, 'admin role can record a login attempt');
  PERFORM works_as('newscafe_admin', format($q$INSERT INTO admin_sessions (user_id, token_hash, expires_at) VALUES (%L, '\x0102'::bytea, now() + interval '1 hour')$q$, own), 'admin role can create a session');
  PERFORM works_as('newscafe_admin', format($q$UPDATE admin_sessions SET revoked_at = now(), last_seen_at = now() WHERE user_id = %L$q$, own), 'admin role can revoke a session');
  PERFORM works_as('newscafe_admin', format($q$UPDATE admin_users SET failed_logins = 1, locked_until = now(), totp_last_step = 5 WHERE id = %L$q$, own), 'admin role can update lockout and 2FA state');
  PERFORM works_as('newscafe_admin', format($q$INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (%L, '\x0a0b'::bytea)$q$, own), 'admin role can store a recovery-code hash');
  PERFORM works_as('newscafe_admin', $q$UPDATE admin_recovery_codes SET used_at = now()$q$, 'admin role can mark a recovery code used');

  -- ================= admin actions: authorisation of the actor =================
  SELECT id INTO ra FROM reservations WHERE reference = ref1;
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.st(gen_random_uuid(), ra, 'confirmed'), 'unknown actor refused');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.st(NULL, ra, 'confirmed'), 'missing actor refused');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.st(mgr, ra, 'confirmed'), 'manager account refused (owner-only)');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.st(dead, ra, 'confirmed'), 'deactivated owner refused');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.ac(mgr, 2, pg_temp.lt(dB, '19:00')), 'manager cannot create staff bookings');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.mv(dead, ra, pg_temp.lt(dA, '20:00')), 'deactivated owner cannot move');
  PERFORM raises_as('newscafe_admin', 'NC906', pg_temp.ed(mgr, ra, '{"notes":"x"}'), 'manager cannot edit');

  -- ================= staff booking, history, audit, actor spoofing =================
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ac(own, 2, pg_temp.lt(dB, '19:00'), NULL, 'web'), 'staff booking cannot claim source web');
  v := scalar_as('newscafe_admin', 'SELECT set_config(''app.actor_id'', ''spoofed-actor'', false)');   -- hostile session setting
  m1 := scalar_as('newscafe_admin', pg_temp.ac(own, 2, pg_temp.lt(dE, '19:00'), 'staff-key-0000000000001'))::uuid;
  PERFORM ok((SELECT status = 'confirmed' AND source = 'phone' AND consent_at IS NULL FROM reservations WHERE id = m1),
             'staff booking is confirmed immediately, source phone');
  PERFORM ok((SELECT actor FROM reservation_events WHERE reservation_id = m1 ORDER BY id LIMIT 1) = own::text,
             'history records the real owner as actor (a spoofed session setting is ignored)');
  PERFORM ok(EXISTS (SELECT 1 FROM audit_logs WHERE action = 'reservation.create' AND actor_id = own AND entity_id = m1::text AND ip_hash = 'iphash1'),
             'creating a booking wrote an audit row with actor and hashed IP');

  -- status transitions
  PERFORM ok(scalar_as('newscafe_admin', pg_temp.st(own, ra, 'confirmed')) = 'confirmed', 'pending -> confirmed');
  PERFORM raises_as('newscafe_admin', 'NC907', pg_temp.st(own, ra, 'pending'), 'confirmed -> pending refused');
  PERFORM raises_as('newscafe_admin', 'NC907', pg_temp.st(own, ra, 'bogus'), 'unknown status refused');
  PERFORM raises_as('newscafe_admin', 'NC907', pg_temp.st(own, ra, NULL), 'NULL status refused');
  PERFORM raises_as('newscafe_admin', 'NC909', pg_temp.st(own, gen_random_uuid(), 'confirmed'), 'unknown reservation reported as not found');
  PERFORM ok(scalar_as('newscafe_admin', pg_temp.st(own, ra, 'completed')) = 'completed', 'confirmed -> completed');
  PERFORM raises_as('newscafe_admin', 'NC907', pg_temp.st(own, ra, 'confirmed'), 'completed is final');
  PERFORM raises_as('newscafe_admin', 'NC907', pg_temp.mv(own, ra, pg_temp.lt(dA, '20:00')), 'a completed reservation cannot be moved');
  PERFORM ok((SELECT count(*) FROM audit_logs WHERE entity_id = ra::text AND action = 'reservation.status') = 2,
             'each successful status change is audited (and failed ones are not)');

  -- cancel releases the table; reinstating re-checks it
  ra := scalar_as('newscafe_admin', pg_temp.ac(own, 1, pg_temp.lt(dC, '19:00'), 'staff-key-0000000000002'))::uuid;
  v := pg_temp.lbl(ra);
  PERFORM ok(scalar_as('newscafe_admin', pg_temp.st(own, ra, 'cancelled', 'guest called')) = 'cancelled', 'confirmed -> cancelled with a reason');
  PERFORM ok((SELECT cancel_reason = 'guest called' AND cancelled_at IS NOT NULL FROM reservations WHERE id = ra), 'reason and time stored');
  PERFORM ok(pg_temp.lbl(ra) IS NULL, 'cancelling released the table');
  rb := scalar_as('newscafe_admin', pg_temp.ac(own, 1, pg_temp.lt(dC, '19:00'), 'staff-key-0000000000003'))::uuid;
  PERFORM ok(pg_temp.lbl(rb) = v, 'another booking took the released table');
  PERFORM raises_as('newscafe_admin', '23P01', pg_temp.st(own, ra, 'confirmed'), 'reinstating onto a table that was taken is refused by the database');
  PERFORM ok((SELECT status FROM reservations WHERE id = ra) = 'cancelled' AND pg_temp.lbl(ra) IS NULL, 'a refused reinstatement changed nothing');
  PERFORM scalar_as('newscafe_admin', pg_temp.st(own, rb, 'cancelled'));
  PERFORM ok(scalar_as('newscafe_admin', pg_temp.st(own, ra, 'confirmed')) = 'confirmed' AND pg_temp.lbl(ra) = v,
             'reinstating works once the table is free again, same table');
  PERFORM ok((SELECT cancelled_at IS NULL AND cancel_reason IS NULL FROM reservations WHERE id = ra), 'reinstating clears the cancellation');
  PERFORM scalar_as('newscafe_admin', pg_temp.st(own, ra, 'no_show'));
  PERFORM ok(pg_temp.lbl(ra) IS NULL, 'no-show releases the table');
  PERFORM ok(scalar_as('newscafe_admin', pg_temp.st(own, ra, 'confirmed')) = 'confirmed', 'no_show -> confirmed (reinstate)');

  -- ================= editing =================
  ra := scalar_as('newscafe_admin', pg_temp.ac(own, 2, pg_temp.lt(dD, '19:00'), 'staff-key-0000000000004'))::uuid;
  PERFORM scalar_as('newscafe_admin', pg_temp.ed(own, ra, '{"guest_name":"Renamed Person","notes":"allergy: nuts"}'));
  PERFORM ok((SELECT guest_name = 'Renamed Person' AND notes = 'allergy: nuts' AND guest_phone = '+27111111111' FROM reservations WHERE id = ra),
             'edit changes only the supplied fields');
  PERFORM scalar_as('newscafe_admin', pg_temp.ed(own, ra, '{"guest_email":null}'));
  PERFORM ok((SELECT guest_email IS NULL FROM reservations WHERE id = ra), 'a field can be cleared with null');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{"guest_phone":null}'), 'cannot remove the last contact method');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{"status":"confirmed"}'), 'status cannot be set through edit');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{"starts_at":"2030-01-01T10:00:00Z"}'), 'times cannot be set through edit');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{"is_test":true}'), 'is_test cannot be set through edit');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{}'), 'empty edit refused');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '["x"]'), 'non-object edit refused');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.ed(own, ra, '{"guest_email":"nope"}'), 'invalid e-mail in edit refused');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM audit_logs
                          WHERE coalesce(before::text, '') || coalesce(after::text, '') ~* '(Staff Guest|Renamed Person|staff@example|27111111111|allergy)'),
             'the audit log never contains guest names, e-mails, phones or notes');
  PERFORM ok((SELECT after #>> '{fields,0}' FROM audit_logs WHERE action = 'reservation.edit' AND entity_id = ra::text ORDER BY id LIMIT 1) IS NOT NULL,
             'the edit audit row lists the changed field names');
  PERFORM ok(EXISTS (SELECT 1 FROM reservation_events WHERE reservation_id = ra AND action = 'edited' AND actor = own::text),
             'the full change is in the append-only reservation history, with the actor');

  -- ================= moving =================
  PERFORM ok(pg_temp.lbl(m1) = 'T1', 'staff booking for 2 sits on the best-fitting table (T1)');
  PERFORM raises_as('newscafe_admin', '22023', pg_temp.mv(own, m1), 'a move with nothing to change is refused');
  PERFORM raises_as('newscafe_admin', 'NC006', pg_temp.mv(own, m1, pg_temp.lt(dE, '19:10')), 'a move off the slot grid is refused');
  PERFORM scalar_as('newscafe_admin', pg_temp.mv(own, m1, pg_temp.lt(dE, '20:00')));
  PERFORM ok((SELECT starts_at = pg_temp.lt(dE, '20:00') AND ends_at = pg_temp.lt(dE, '21:00') FROM reservations WHERE id = m1), 'move changed the times');
  PERFORM ok((SELECT count(*) = 1 AND bool_and(active) AND bool_and(lower(during) = pg_temp.lt(dE, '20:00'))
                FROM table_allocations WHERE reservation_id = m1), 'exactly one allocation, in step with the new time');
  PERFORM ok(pg_temp.lbl(m1) = 'T1', 'the move kept the same table because it was free');
  PERFORM ok(EXISTS (SELECT 1 FROM reservation_events WHERE reservation_id = m1 AND action = 'tables_changed' AND actor = own::text),
             'the move is in the reservation history with the actor');
  PERFORM ok(EXISTS (SELECT 1 FROM audit_logs WHERE action = 'reservation.move' AND entity_id = m1::text AND actor_id = own),
             'the move is in the audit log');
  PERFORM raises('NC903', format('UPDATE reservations SET starts_at = starts_at + interval ''1 hour'', ends_at = ends_at + interval ''1 hour'' WHERE id = %L', m1),
                 'after a move the guard still blocks direct time changes (no leftover "moving" switch)');
  -- party change: needs a bigger table and re-resolves the duration from the owner's rules
  PERFORM scalar_as('newscafe_admin', pg_temp.mv(own, m1, NULL, 4));
  PERFORM ok(pg_temp.lbl(m1) = 'T3' AND (SELECT duration_minutes = 90 AND party_size = 4 FROM reservations WHERE id = m1),
             'party of 4 moved to T3 with the 90 min rule applied');
  PERFORM raises_as('newscafe_admin', 'NC004', pg_temp.mv(own, m1, NULL, 0), 'party of 0 refused');
  -- explicit table choice
  PERFORM raises_as('newscafe_admin', 'NC004', pg_temp.mv(own, m1, NULL, NULL, NULL, t1), 'T1 cannot seat 4: refused');
  PERFORM scalar_as('newscafe_admin', pg_temp.mv(own, m1, NULL, 2, 60, t2));
  PERFORM ok(pg_temp.lbl(m1) = 'T2', 'the owner can pick a specific table');
  -- a move into a full house fails as a whole and changes nothing (all four tables taken at 21:30)
  FOR n IN 1..4 LOOP
    PERFORM scalar_as('newscafe_admin', pg_temp.ac(own, 2, pg_temp.lt(dE, '21:30'), 'staff-key-fill-00000' || n));
  END LOOP;
  PERFORM ok((SELECT count(DISTINCT a.table_id) FROM table_allocations a JOIN reservations r ON r.id = a.reservation_id
               WHERE r.starts_at = pg_temp.lt(dE, '21:30') AND a.active) = 4, 'all four tables are taken at 21:30');
  SELECT count(*) INTO n FROM table_allocations WHERE reservation_id = m1;
  SELECT count(*) INTO ev FROM reservation_events WHERE reservation_id = m1;
  PERFORM raises_as('newscafe_admin', 'NC002', pg_temp.mv(own, m1, pg_temp.lt(dE, '21:30')), 'moving into a full house is refused');
  PERFORM raises_as('newscafe_admin', 'NC002', pg_temp.mv(own, m1, pg_temp.lt(dE, '21:30'), NULL, NULL, t3), 'moving onto an explicitly chosen table that is taken is refused');
  PERFORM ok((SELECT starts_at = pg_temp.lt(dE, '20:00') FROM reservations WHERE id = m1) AND pg_temp.lbl(m1) = 'T2'
             AND (SELECT count(*) FROM table_allocations WHERE reservation_id = m1) = n
             AND (SELECT count(*) FROM reservation_events WHERE reservation_id = m1) = ev,
             'refused moves left the reservation, its table and its history exactly as they were');
  -- availability now reflects the full evening
  PERFORM ok(NOT EXISTS (SELECT 1 FROM available_slots(loc, dE, 1) WHERE slot_start = pg_temp.lt(dE, '21:30')),
             '21:30 is no longer offered once every table is taken');
  PERFORM ok(EXISTS (SELECT 1 FROM available_slots(loc, dE, 1) WHERE slot_start = pg_temp.lt(dE, '18:00')),
             '18:00 is still offered');

  RAISE NOTICE 'finished: api role tests complete (transaction is rolled back)';
END $$;

ROLLBACK;
