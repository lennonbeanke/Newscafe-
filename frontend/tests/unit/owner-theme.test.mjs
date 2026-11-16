// Unit tests for the owner Light/Dark theme: what the pre-paint script does, what may be stored, and that both colour sets are complete and readable.
//   node --test "tests/unit/*.test.mjs"
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { OWNER_THEME_ATTR, OWNER_THEME_DEFAULT, OWNER_THEME_KEY, isOwnerTheme, ownerThemeInitScript, readSavedOwnerTheme, saveOwnerTheme } from "../../lib/owner-theme.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

/** Runs a piece of browser code against a fake page whose storage is `storage` (an object, or a function that throws). */
function runInFakePage(code, storage) {
  const attrs = {}, writes = [];
  const localStorage = typeof storage === "function" ? { getItem: storage, setItem: storage } : { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { writes.push([k, v]); storage[k] = v; } };
  const documentElement = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null };
  vm.runInNewContext(code, { localStorage, document: { documentElement } });
  return { attrs, writes };
}

describe("owner theme: the pre-paint script", () => {
  it("starts in Light when nothing is saved (the device preference is ignored by design)", () => {
    assert.equal(OWNER_THEME_DEFAULT, "light");
    assert.deepEqual(runInFakePage(ownerThemeInitScript, {}).attrs, { [OWNER_THEME_ATTR]: "light" });
  });
  it("uses a saved Dark or Light", () => {
    assert.equal(runInFakePage(ownerThemeInitScript, { [OWNER_THEME_KEY]: "dark" }).attrs[OWNER_THEME_ATTR], "dark");
    assert.equal(runInFakePage(ownerThemeInitScript, { [OWNER_THEME_KEY]: "light" }).attrs[OWNER_THEME_ATTR], "light");
  });
  it("ignores anything that is not exactly 'light' or 'dark'", () => {
    for (const bad of ["", "DARK", "Dark ", "<script>alert(1)</script>", "auto", "1", "null", "dark;light"]) assert.equal(runInFakePage(ownerThemeInitScript, { [OWNER_THEME_KEY]: bad }).attrs[OWNER_THEME_ATTR], "light", JSON.stringify(bad));
  });
  it("still works when storage is blocked (throws)", () => {
    assert.equal(runInFakePage(ownerThemeInitScript, () => { throw new Error("blocked"); }).attrs[OWNER_THEME_ATTR], "light");
  });
  it("only sets the one attribute and never writes to storage", () => {
    const { attrs, writes } = runInFakePage(ownerThemeInitScript, { [OWNER_THEME_KEY]: "dark" });
    assert.deepEqual(Object.keys(attrs), [OWNER_THEME_ATTR]);
    assert.equal(writes.length, 0);
  });
});

describe("owner theme: what may be stored", () => {
  it("accepts only the two words", () => {
    assert.equal(isOwnerTheme("light"), true); assert.equal(isOwnerTheme("dark"), true);
    for (const v of ["", "Light", null, undefined, 1, {}, "dark "]) assert.equal(isOwnerTheme(v), false);
  });
  it("reads and writes one key, with only the theme word, and survives blocked storage", () => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    try {
      assert.equal(readSavedOwnerTheme(), "light");
      saveOwnerTheme("dark");
      assert.deepEqual(store, { "nc-owner-theme": "dark" });
      assert.equal(readSavedOwnerTheme(), "dark");
      store[OWNER_THEME_KEY] = "garbage"; assert.equal(readSavedOwnerTheme(), "light");
      globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
      assert.equal(readSavedOwnerTheme(), "light"); assert.doesNotThrow(() => saveOwnerTheme("dark"));
    } finally { delete globalThis.localStorage; }
  });
  it("uses its own key, separate from the public site's theme choice", () => {
    assert.equal(OWNER_THEME_KEY, "nc-owner-theme");
    assert.match(read("lib/theme.ts"), /THEME_KEY = "nc-theme"/);
  });
  it("browser storage is touched by exactly this one module, never by the admin folders, and the owner screens never write anything but the theme", () => {
    const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
    const users = [];
    for (const dir of ["app/admin", "components/admin", "lib/admin", "components/owner-theme", "lib/owner-theme.ts"]) {
      const full = join(root, dir);
      for (const f of statSync(full).isDirectory() ? walk(full) : [full]) if (/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(strip(readFileSync(f, "utf8")))) users.push(relative(root, f).replaceAll("\\", "/"));
    }
    assert.deepEqual(users, ["lib/owner-theme.ts"]);
    const code = strip(read("lib/owner-theme.ts"));
    assert.equal((code.match(/localStorage\.setItem\(/g) ?? []).length, 1);
    assert.match(code, /localStorage\.setItem\(OWNER_THEME_KEY, theme\)/);
    assert.equal((code.match(/localStorage\.getItem\(/g) ?? []).length, 2, "one read in readSavedOwnerTheme, one in the pre-paint script");
    assert.doesNotMatch(strip(read("components/owner-theme/OwnerTheme.tsx")), /localStorage|sessionStorage|indexedDB/);
  });
});

describe("owner theme: the colour sets", () => {
  const css = read("styles/globals.css");
  // a rule whose selector starts a line (so the combined "light, dark" rule is not mistaken for the Dark rule)
  const block = (sel) => { const i = css.split("\n").findIndex((l) => l === `${sel} {`); assert.ok(i >= 0, sel); const rest = css.split("\n").slice(i).join("\n"); return rest.slice(0, rest.indexOf("}")); };
  const vars = (b) => Object.fromEntries([...b.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = vars(block('html[data-admin-theme="light"]')), dark = vars(block('html[data-admin-theme="dark"]')), nav = vars(block('html[data-admin-theme="light"], html[data-admin-theme="dark"]'));
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it("Light and Dark define exactly the same variables, so no component can be left half-themed", () => {
    assert.ok(Object.keys(light).length >= 11, `light has ${Object.keys(light).length}`);
    assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
    for (const k of ["--color-ink", "--color-coal", "--color-onyx", "--color-smoke", "--color-bone", "--color-mist", "--color-gold", "--color-gold-light", "--color-gold-deep", "--color-ok", "--color-danger"]) assert.ok(k in light, k);
  });
  it("Light is a light page with white cards; Dark is a dark page (but not pure black)", () => {
    assert.ok(lum(light["--color-onyx"]) > 0.9 && lum(light["--color-ink"]) > 0.8);
    assert.ok(lum(dark["--color-ink"]) < 0.02 && lum(dark["--color-ink"]) > 0, "dark page");
    assert.notEqual(dark["--color-ink"], "#000000");
  });
  it("every text colour reaches WCAG AA (4.5:1) on the surfaces it is used on, in both themes", () => {
    for (const [name, set] of [["light", light], ["dark", dark]]) {
      for (const [fg, bg] of [["--color-bone", "--color-onyx"], ["--color-bone", "--color-ink"], ["--color-bone", "--color-coal"], ["--color-mist", "--color-onyx"], ["--color-mist", "--color-ink"], ["--color-mist", "--color-coal"], ["--color-gold", "--color-onyx"], ["--color-gold", "--color-ink"], ["--color-ink", "--color-gold"], ["--color-ok", "--color-onyx"], ["--color-danger", "--color-onyx"], ["--color-gold-light", "--color-onyx"]])
        assert.ok(ratio(set[fg], set[bg]) >= 4.5, `${name}: ${fg} on ${bg} = ${ratio(set[fg], set[bg]).toFixed(2)}`);
    }
  });
  it("the sidebar is charcoal in both themes and its text is readable", () => {
    assert.ok(lum(nav["--nav-bg"]) < 0.02);
    for (const fg of ["--nav-text", "--nav-mute", "--nav-faint", "--nav-gold"]) assert.ok(ratio(nav[fg], nav["--nav-bg"]) >= 4.5, `${fg} = ${ratio(nav[fg], nav["--nav-bg"]).toFixed(2)}`);
  });
  it("the owner colours apply only under the owner attribute, so the public site keeps its own", () => {
    assert.ok(!/^html\[data-admin-theme[^{]*\{[^}]*\}[\s\S]*^:root/m.test(css));
    for (const m of css.matchAll(/^(html\[data-admin-theme[^{]*)\{/gm)) assert.match(m[1], /data-admin-theme/);
  });
});

describe("owner theme: wiring", () => {
  it("the owner layout puts the script first and wraps the screens in the provider", () => {
    const layout = strip(read("app/admin/layout.tsx"));
    assert.ok(layout.indexOf("<OwnerThemeScript") < layout.indexOf("<OwnerThemeProvider"));
    assert.match(strip(read("components/owner-theme/OwnerThemeScript.tsx")), /ownerThemeInitScript/);
  });
  it("the shell contains the visible toggle", () => assert.match(strip(read("components/admin/AdminShell.tsx")), /<OwnerThemeToggle/));
  it("the toggle is a labelled group of real buttons with aria-pressed", () => {
    const c = strip(read("components/owner-theme/OwnerTheme.tsx"));
    assert.match(c, /role="group"/); assert.match(c, /aria-label="Colour theme"/); assert.match(c, /aria-pressed=\{theme === mode\}/); assert.match(c, /<button/);
  });
});
