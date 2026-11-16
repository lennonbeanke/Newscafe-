// Parity tests: places where the FRONTEND must read the BACKEND's data exactly the way the backend writes it.
// (Owner sign-in is e-mail and password only, so there are no code formats to compare any more.)
// They need both areas side by side (that is why they live in e2e/, not in frontend/ or backend/) but no running server or database.
//   node --test e2e/parity.test.mjs        (Node 24)
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { describeActivity, parseAudit, STATUS_LABEL } from "../frontend/lib/admin/dashboard.ts";
import { ReservationStatus } from "../backend/src/admin/schemas.ts";
import { checkNewPassword, MIN_NEW_PASSWORD_LENGTH } from "../backend/src/auth/password.ts";

describe("sign-in limits: what the login form allows matches what the backend accepts", () => {
  it("the login form's 128-character password limit is the backend's", () => {
    const flow = fs.readFileSync(new URL("../frontend/components/admin/LoginFlow.tsx", import.meta.url), "utf8");
    const schema = fs.readFileSync(new URL("../backend/src/admin/schemas.ts", import.meta.url), "utf8");
    assert.match(flow, /name="password"[^>]*maxLength=\{128\}/s);
    assert.match(schema, /password: z\.string\(\)\.min\(1\)\.max\(128\)/);
  });
  it("a new owner password rule exists and is at least 12 characters", () => { assert.equal(MIN_NEW_PASSWORD_LENGTH, 12); assert.ok(checkNewPassword("short")); assert.equal(checkNewPassword("long enough password"), null); });
});

describe("reservation statuses and audit actions: the dashboard knows everything the API can send", () => {
  it("knows exactly the reservation statuses the API can send", () => assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...ReservationStatus.options].sort()));
  it("knows every audit action the API and the database functions can write", () => {
    const src = readFileSync(new URL("../backend/src/admin-app.ts", import.meta.url), "utf8") + readFileSync(new URL("../backend/database/migrations/0009_api_functions.sql", import.meta.url), "utf8");
    const actions = [...new Set([...src.matchAll(/'((?:auth|reservation)\.[a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(actions.length >= 9, `found only ${actions.length}`);   // login, failed, locked, logout + the reservation actions
    const row = (action) => parseAudit({ id: 1, at: "2026-11-12T10:00:00Z", actor_email: null, action, entity_type: "x", after: null });
    const unknown = actions.filter((x) => describeActivity(row(x)).kind === "other");
    assert.deepEqual(unknown, [], `unmapped audit actions: ${unknown.join(", ")}`);
  });
});
