// Static security rules for the owner screens. These fail the build of trust if someone later adds browser storage, secrets or direct
// calls to the wrong API. Run with:   node --test tests/admin/
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADMIN_DIRS = ["lib/admin", "components/admin", "app/admin"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = ADMIN_DIRS.flatMap((d) => walk(join(root, d)));
const read = (p) => readFileSync(p, "utf8");
// Drop line comments first, then block comments (comments may explain what is forbidden, and a line comment can contain "/*").
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const rel = (p) => relative(root, p).replaceAll("\\", "/");

describe("owner screens: what they must never do", () => {
  it("found the files to check", () => assert.ok(files.length >= 8, `only ${files.length} files`));

  it("never use browser storage or cookies from script", () => {
    for (const f of files) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /\b(localStorage|sessionStorage|indexedDB|openDatabase|caches\b|document\.cookie|cookieStore)\b/, rel(f));
    }
  });

  it("never touch the URL with secrets, and never log", () => {
    for (const f of files) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /\bconsole\.\w+\(/, `${rel(f)} must not log`);
      assert.doesNotMatch(code, /history\.(pushState|replaceState)/, rel(f));
      assert.doesNotMatch(code, /(dangerouslySetInnerHTML|\beval\(|new Function\()/, rel(f));
    }
  });

  it("never read environment variables or know the admin API address or any secret name", () => {
    for (const f of files) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /process\.env|NEXT_PUBLIC_|import\.meta\.env/, rel(f));
      assert.doesNotMatch(code, /127\.0\.0\.1|localhost|:878[78]/, `${rel(f)} must only use the relative /api/admin path`);
      assert.doesNotMatch(code, /API_HMAC_KEY|API_TOTP_ENC_KEY|API_DB_|HMAC|PASSWORD_KEY/i, rel(f));
    }
  });

  it("only the API client calls fetch, and only on /api/admin (never the public API)", () => {
    for (const f of files) {
      const code = strip(read(f));
      const callsFetch = /\bfetch\(/.test(code) || /XMLHttpRequest|navigator\.sendBeacon|new WebSocket/.test(code);
      if (rel(f) === "lib/admin/api.ts") {
        assert.ok(callsFetch);
        assert.match(code, /`\$\{ADMIN_API_BASE\}\$\{path\}`/);
        assert.match(code, /credentials: "same-origin"/);
        assert.match(code, /cache: "no-store"/);
        assert.match(code, /redirect: "error"/);
      } else assert.equal(callsFetch, false, `${rel(f)} must go through lib/admin/api.ts`);
      assert.doesNotMatch(code, /\/api\/(?!admin\b)/, `${rel(f)} must not call the public API`);
    }
    assert.equal(read(join(root, "lib/admin/pure.ts")).includes('ADMIN_API_BASE = "/api/admin"'), true);
  });

  it("keep the CSRF token in memory only", () => {
    const code = strip(read(join(root, "lib/admin/api.ts")));
    assert.match(code, /let csrfToken: string \| null = null;/);
  });
});

describe("dashboard overview: read-only and never polling", () => {
  const dash = [...walk(join(root, "components/admin/dashboard")), join(root, "lib/admin/dashboard.ts")];
  it("found the dashboard files", () => assert.ok(dash.length >= 4));
  it("makes only GET calls through adminGet (no writes, no sign-in calls)", () => {
    for (const f of dash) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /\b(POST|PUT|PATCH|DELETE)\b/, rel(f));
      // the audit-log wording mentions "auth.login" as DATA; what matters is which functions are imported from the API client
      for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/admin\/api"/g)) assert.doesNotMatch(m[1], /\b(login|logout|me|adminPost|adminPatch)\b/, `${rel(f)} imports a sign-in or write call`);
    }
    assert.match(strip(read(join(root, "components/admin/dashboard/useOverview.ts"))), /adminGet/);
  });
  it("has no timers, so it can never keep an idle session alive", () => {
    for (const f of dash) assert.doesNotMatch(strip(read(f)), /\b(setInterval|setTimeout|requestIdleCallback|EventSource|WebSocket)\b/, rel(f));
  });
});

describe("reservation screens: the only writes are the six the API offers, and nothing is kept in the browser", () => {
  const api = strip(read(join(root, "lib/admin/reservation-api.ts")));
  it("only lib/admin/reservation-api.ts uses the write helpers", () => {
    for (const f of files) {
      const importsWrite = /\b(adminPost|adminPatch)\b/.test(strip(read(f)));
      assert.equal(importsWrite, ["lib/admin/api.ts", "lib/admin/reservation-api.ts"].includes(rel(f)), `${rel(f)}: write helpers must be used only by reservation-api.ts`);
    }
  });
  it("calls only the owner API's reservation, tables and status paths, and builds paths from a checked UUID", () => {
    assert.match(api, /UUID_RE\.test\(id\)/);
    const paths = [...api.matchAll(/["`]([^"`]*\/[^"`]*)["`]/g)].map((m) => m[1]).filter((p) => p.startsWith("/") || p.startsWith("${"));   // request paths (not module imports like "./api")
    assert.ok(paths.length >= 4, `found only ${paths.length} request paths`);
    for (const p of paths) assert.match(p, /^(\/reservations(\/\$\{id\})?|\/tables|\$\{idPath\(id\)\}(\/\$\{action\}|\/move)?)$/, `unexpected path: ${p}`);
    assert.doesNotMatch(api, /\bDELETE\b|\bPUT\b/);
  });
  it("keeps the list filters in memory: not in the URL, not in storage", () => {
    const filters = strip(read(join(root, "lib/admin/filters.ts")));
    assert.doesNotMatch(filters, /localStorage|sessionStorage|document\.cookie|history\.|location\.|useSearchParams|router\./);
    const list = strip(read(join(root, "components/admin/reservations/ReservationsList.tsx")));
    assert.doesNotMatch(list, /useSearchParams|router\.(push|replace)|location\./, "a guest search must never be put in the page URL");
  });
  it("never uses window.confirm or alert (confirmations are on the page, readable by screen readers)", () => {
    for (const f of files.filter((x) => rel(x).includes("reservations"))) assert.doesNotMatch(strip(read(f)), /\b(window\.)?(confirm|alert|prompt)\(/, rel(f));
  });
});

describe("owner login: e-mail and password only", () => {
  const flow = strip(read(join(root, "components/admin/LoginFlow.tsx")));
  it("has no authenticator, recovery-code or second-step wording or code in the whole admin area", () => {
    for (const f of files) {
      const code = strip(read(f));
      if (rel(f).startsWith("lib/admin/dashboard.ts")) continue;     // old audit events keep their labels so the history stays readable
      assert.doesNotMatch(code, /authenticator|recovery[ _-]?code|setup key|set-up key|otpauth|one-time-code|second[ -]?(factor|step)|two-factor|totp/i, rel(f));
    }
  });
  it("the login screen asks for exactly an e-mail address and a password and calls only login()", () => {
    assert.deepEqual([...flow.matchAll(/name="([a-z-]+)"/g)].map((m) => m[1]), ["email", "password"]);
    assert.match(flow, /api\.login\(/);
    assert.doesNotMatch(flow, /api\.(submit|enrol|totp)/i);
    assert.equal((flow.match(/api\.[a-zA-Z]+\(/g) ?? []).length, 1);
  });
  it("the password never goes anywhere but the login request, and is cleared after every attempt", () => {
    assert.equal((flow.match(/\bpassword\b[^\n]*(console|localStorage|sessionStorage|router\.|href|history)/g) ?? []).length, 0);
    assert.ok((flow.match(/setPassword\(""\)/g) ?? []).length >= 2, "cleared on success and on failure");
  });
  it("the API client has no second-factor calls", () => assert.doesNotMatch(strip(read(join(root, "lib/admin/api.ts"))), /totp|recovery|enroll|submitTotp|submitRecovery/i));
});

describe("next.config.ts", () => {
  const cfg = strip(read(join(root, "next.config.ts")));
  it("proxies only the owner API path, only outside production, to the fixed loopback address", () => {
    assert.match(cfg, /ADMIN_API_ORIGIN = "http:\/\/127\.0\.0\.1:8788"/);
    assert.match(cfg, /source: "\/api\/admin\/:path\*"/);
    assert.match(cfg, /NODE_ENV === "production"\) return \[\]/);
    assert.doesNotMatch(cfg, /8787/, "the public API must not be proxied");
  });
  it("marks the owner pages private", () => {
    for (const h of ["no-store", "DENY", "no-referrer", "nosniff", "noindex"]) assert.ok(cfg.includes(h), h);
    assert.match(cfg, /source: "\/admin\/:path\*"/);
  });
});

describe("robots", () => {
  it("keeps crawlers out of the owner area", () => assert.match(read(join(root, "app/robots.ts")), /disallow: \["\/admin", "\/api\/admin"\]/));
});
