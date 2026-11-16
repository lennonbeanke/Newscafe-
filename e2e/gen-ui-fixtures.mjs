// Regenerates frontend/tests/fixtures/admin-api.json: FAKE development data in exactly the shape the owner API returns, so the frontend's
// browser test can run without the backend. Needs the development database container to be running (read-only SELECTs only).
//   node e2e/gen-ui-fixtures.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const env = readFileSync(new URL("../backend/database/.env", import.meta.url), "utf8");
const user = /^POSTGRES_USER=(.*)$/m.exec(env)?.[1];
const db = /^POSTGRES_DB=(.*)$/m.exec(env)?.[1];
if (db !== "newscafe_dev") throw new Error("Refused: only the newscafe_dev database.");
const psql = (q) => JSON.parse(execFileSync("docker", ["exec", "newscafe-db-dev", "psql", "-X", "-q", "-U", user, "-d", db, "-tAc", q], { encoding: "utf8" }).trim() || "null");

const reservations = psql(`select json_agg(x) from (select r.id, r.reference, r.status, r.party_size, r.starts_at, r.ends_at, r.duration_minutes, r.guest_name, r.guest_email::text as guest_email, r.guest_phone, r.notes, r.source, r.is_test, r.consent_at, r.created_at, r.updated_at, r.confirmed_at, r.cancelled_at, r.cancel_reason, COALESCE((SELECT array_agg(t.label ORDER BY t.label) FROM table_allocations a JOIN dining_tables t ON t.id = a.table_id WHERE a.reservation_id = r.id AND a.active AND a.kind = 'reservation'), '{}') AS tables from reservations r order by starts_at) x`);
const readiness = psql(`select row_to_json(x) from reservation_readiness x`);
const tables = psql(`select json_agg(x) from (select id, label, section, min_covers, max_covers, is_active, online_bookable from dining_tables order by sort, label) x`);
const audit = psql(`select json_agg(x) from (select a.id, a.at, a.actor_id, u.email::text as actor_email, a.action, a.entity_type, a.entity_id, a.before, a.after from audit_logs a left join admin_users u on u.id = a.actor_id order by a.id desc limit 50) x`);

const out = {
  _note: "FAKE development data only (placeholder cafe, @example.invalid addresses, 'Test Guest' names). Shapes copied from the owner API's own queries. Regenerate with: node e2e/gen-ui-fixtures.mjs",
  reservations, readiness, tables, audit,
};
const file = new URL("../frontend/tests/fixtures/admin-api.json", import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote frontend/tests/fixtures/admin-api.json: ${reservations.length} reservations, ${tables.length} tables, ${audit.length} audit rows`);
