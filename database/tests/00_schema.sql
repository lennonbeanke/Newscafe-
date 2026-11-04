-- Structural checks: the safety features exist and are switched on.
\set ON_ERROR_STOP on
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_allocations_no_overlap' AND contype = 'x'),
          'exclusion constraint table_allocations_no_overlap exists');
SELECT ok((SELECT count(*) FROM pg_trigger WHERE tgname IN
             ('reservation_events_append_only', 'audit_logs_append_only', 'app_environment_immutable',
              'menu_price_history_append_only') AND NOT tgisinternal) = 4,
          'append-only / immutable triggers exist');
SELECT ok((SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%no_fake_email' AND NOT tgisinternal) >= 4,
          'fake e-mail triggers exist on customer-facing tables');
SELECT ok((SELECT env FROM app_environment) IN ('development', 'staging', 'production'), 'environment label is set');
SELECT ok(NOT EXISTS (SELECT 1 FROM admin_users), 'no owner accounts are created by migrations');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.routines
                       WHERE routine_schema = 'public' AND routine_name ILIKE '%register%'),
          'there is no registration function');
SELECT ok((SELECT flag_enabled FROM menu_settings) = false, 'N badge is switched off by default');
SELECT ok((SELECT auto_confirm_enabled FROM reservation_settings LIMIT 1) IS DISTINCT FROM true,
          'auto-confirm is never on by default');
