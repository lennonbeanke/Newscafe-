// Unit tests for the owner sign-in helpers (e-mail and password only: there are no code helpers any more). Run with Node 24 (no extra packages):   node --test tests/admin/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHeaders, CSRF_HEADER_VALUE, friendlyMessage, isEmail, safeNextPath,
} from "../../lib/admin/pure.ts";

describe("buildHeaders (CSRF headers for the owner API)", () => {
  it("sends no CSRF headers on reads", () => {
    const h = buildHeaders("GET", "tok", false);
    assert.equal(h["X-Requested-With"], undefined);
    assert.equal(h["X-CSRF-Token"], undefined);
    assert.equal(h["Content-Type"], undefined);
    assert.equal(h.Accept, "application/json");
  });
  it("sends the fixed header and the token on every state-changing request", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const h = buildHeaders(m, "tok-123", true);
      assert.equal(h["X-Requested-With"], CSRF_HEADER_VALUE);
      assert.equal(h["X-CSRF-Token"], "tok-123");
      assert.equal(h["Content-Type"], "application/json");
    }
  });
  it("matches the value the API requires", () => assert.equal(CSRF_HEADER_VALUE, "newscafe-admin"));
  it("omits the token (but not the header) before one exists, e.g. the first login request", () => {
    const h = buildHeaders("POST", null, true);
    assert.equal(h["X-Requested-With"], "newscafe-admin");
    assert.equal(h["X-CSRF-Token"], undefined);
  });
  it("only adds Content-Type when there is a body (logout has none)", () => assert.equal(buildHeaders("POST", "t", false)["Content-Type"], undefined));
});

describe("e-mail check", () => {
  it("is a cheap sanity check only (the API is the real validator)", () => {
    assert.ok(isEmail("dev-owner@example.invalid"));
    for (const s of ["", "a", "a@b", "a b@c.d", "@c.d", "a@.", `${"a".repeat(250)}@b.cd`]) assert.equal(isEmail(s), false, s);
  });
});

describe("safeNextPath (no open redirect)", () => {
  it("keeps genuine admin paths", () => {
    for (const p of ["/admin", "/admin/reservations", "/admin/reservations/abc-123", "/admin/reservations?status=pending&q=jane"]) assert.equal(safeNextPath(p), p);
  });
  it("falls back to /admin for anything that could leave the admin area", () => {
    const evil = [
      "https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil.example", "http://localhost:3000/admin", "javascript:alert(1)", "data:text/html,x",
      "/adminx", "/administrator", "/menu", "/", "", "admin", "/admin/../menu", "/admin//evil.example", "/admin/%2e%2e/menu", "/admin#frag", "/admin?next=//evil",
      "/admin/\nSet-Cookie:x=1", "/admin/ x", "/admin/login", "/admin/login?next=/admin", "/admin/login/x", `/admin/${"a".repeat(300)}`,
    ];
    for (const p of evil) assert.equal(safeNextPath(p), "/admin", JSON.stringify(p));
    assert.equal(safeNextPath(null), "/admin");
    assert.equal(safeNextPath(undefined), "/admin");
  });
});

describe("error messages", () => {
  const e = (status, code, extra = {}) => ({ status, code, ...extra });
  it("login failures give one message, whatever the cause (no way to learn which e-mails exist or are locked)", () => {
    const a = friendlyMessage(e(401, "invalid_credentials"), "password");
    assert.equal(a, "The e-mail address or password is not correct.");
    assert.equal(friendlyMessage(e(401, "invalid_credentials", { apiMessage: "x" }), "password"), a);
    assert.doesNotMatch(a, /lock|exist|unknown|deactivat/i);
  });
  it("a 'not signed in' answer is plain and does not mention any code", () => {
    assert.match(friendlyMessage(e(401, "unauthenticated")), /not signed in/i);
    assert.equal(friendlyMessage(e(401, "unauthenticated"), "password"), "The e-mail address or password is not correct.");
    for (const m of [friendlyMessage(e(401, "unauthenticated")), friendlyMessage(e(401, "invalid_credentials"), "password")]) assert.doesNotMatch(m, /code|authenticator|recovery/i);
  });
  it("rate limiting rounds the wait up to whole minutes", () => {
    assert.match(friendlyMessage(e(429, "rate_limited", { retryAfterSeconds: 900 })), /15 minutes/);
    assert.match(friendlyMessage(e(429, "rate_limited", { retryAfterSeconds: 61 })), /2 minutes/);
    assert.match(friendlyMessage(e(429, "rate_limited", { retryAfterSeconds: 10 })), /1 minute\b/);
    assert.match(friendlyMessage(e(429, "rate_limited")), /few minutes/);
  });
  it("handles network, CSRF, validation and outage failures without leaking detail", () => {
    assert.match(friendlyMessage(e(0, "network")), /could not reach/i);
    assert.match(friendlyMessage(e(403, "csrf_origin")), /blocked for your safety/);
    assert.match(friendlyMessage(e(422, "validation_failed")), /check what you entered/);
    assert.match(friendlyMessage(e(503, "service_unavailable")), /temporarily unavailable/);
    assert.match(friendlyMessage(e(500, "internal_error", { apiMessage: "SELECT * FROM admin_users" })), /temporarily unavailable/);
  });
  it("never repeats an over-long or unknown server message", () => {
    assert.equal(friendlyMessage(e(418, "teapot", { apiMessage: "x".repeat(500) })), "Something went wrong. Please try again.");
    assert.equal(friendlyMessage(e(418, "teapot", { apiMessage: "Short message." })), "Short message.");
  });
});
