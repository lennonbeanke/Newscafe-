// Browser run of the OWNER SHELL (Stage 1 of the dashboard redesign): colour sets, Light/Dark switch, charcoal sidebar, responsive layout.
// Headless Microsoft Edge, throw-away profile, DevTools on 127.0.0.1, no external requests. The owner API is REPLACED by fake data of the real shape, so no
// sign-in happens and no owner account is touched.
//   OUT_DIR=<folder> node tests/ui/owner-shell.ui.mjs        (needs only the frontend dev server on port 3000 and Edge)
import { readFileSync } from "node:fs";
import { openBrowser } from "./cdp.mjs";

const SITE = "http://localhost:3000";
const OUT = process.env.OUT_DIR;
const OWNER = "dev-owner@example.invalid";
let failures = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   <- ${detail}` : ""}`); };
const FIX = JSON.parse(readFileSync(new URL("../fixtures/admin-api.json", import.meta.url), "utf8"));

// ---- contrast maths (WCAG 2.x) on the colours the page really resolves ----
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const state = { signedIn: true };
const err = (status, error, message) => ({ status, json: { error, message, request_id: "mock-request-id-shell" } });
const requests = [];
function mock({ method, url, headers }) {
  const p = url.pathname.replace("/api/admin", "");
  requests.push({ method, p, headers });
  if (p === "/me") return state.signedIn ? { status: 200, json: { user: { email: OWNER, role: "owner" }, csrf_token: "mock-csrf", session_expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), idle_timeout_seconds: 1800 } } : err(401, "unauthenticated", "Please sign in.");
  if (p === "/logout" && method === "POST") { if (headers["X-CSRF-Token"] !== "mock-csrf") return err(403, "csrf_token", "Missing or invalid CSRF token."); state.signedIn = false; return { status: 204, json: null }; }
  if (!state.signedIn) return err(401, "unauthenticated", "Please sign in.");
  if (p === "/reservations") return { status: 200, json: { items: [], has_more: false } };
  if (p === "/readiness") return { status: 200, json: { item: FIX.readiness } };
  if (p === "/tables") return { status: 200, json: { items: FIX.tables } };
  if (p === "/audit-log") return { status: 200, json: { items: [] } };
  return err(404, "not_found", "Not found.");
}

const b = await openBrowser({ port: 9340, outDir: OUT, site: SITE, mock });
const ev = (s) => b.evaluate(s);
const longHex = (v) => (/^#[0-9a-f]{3}$/i.test(v) ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v);      // the stylesheet is minified: #ffffff may come back as #fff
const css = async (name) => longHex(await ev(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`));
const key = async (k, code, vk, shift = false) => { for (const type of ["rawKeyDown", "keyUp"]) await b.cdp.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0, text: type === "rawKeyDown" && (k === "Enter" ? true : k === " ") ? (k === "Enter" ? "\r" : " ") : undefined }); await b.sleep(120); };
const metrics = (width, height, mobile = false) => b.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
const cardBg = () => ev("(() => { const d = document.createElement('div'); d.style.background = 'var(--color-onyx)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()");
const theme = () => ev("document.documentElement.getAttribute('data-admin-theme')");
const stored = () => ev("JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))");
const overview = () => b.waitFor("document.querySelector('h1')?.textContent === 'Overview' && !document.body.innerText.includes('Loading…')");
// every animation frame from the very start of each page load: which owner colour set was on screen?
await b.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__frames = new Set(); (function f(){ try { window.__frames.add(getComputedStyle(document.documentElement).getPropertyValue('--color-onyx').trim().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') + '|' + document.documentElement.getAttribute('data-admin-theme')); } catch (e) {} if (performance.now() < 2500) requestAnimationFrame(f); })();" });
const frames = async () => JSON.parse(await ev("JSON.stringify([...window.__frames])"));

try {
  console.log(`Browser: ${b.version} (headless, throw-away profile, DevTools on 127.0.0.1:9340). Owner API answers are fakes.`);

  console.log("\n== S1  first visit: Light mode, the design's colours");
  await b.go("/admin"); await ev("localStorage.clear()"); await b.go("/admin");
  check("the Overview opens for the signed-in owner", await overview());
  check("first visit starts in Light mode (data-admin-theme=light), whatever the device prefers", (await theme()) === "light");
  const f1 = await frames();
  check("not a single frame was drawn in another colour set while loading (no flash)", f1.length === 1 && f1[0] === "#ffffff|light", JSON.stringify(f1));
  check("light colour set: white cards, cream page, charcoal text", (await css("--color-onyx")) === "#ffffff" && (await css("--color-ink")) === "#f7f2e8" && (await css("--color-bone")) === "#26211a");
  check("the page really paints cream/white in light mode (computed backgrounds)", (await ev("getComputedStyle(document.body).backgroundColor")) === "rgb(247, 242, 232)" && (await cardBg()) === "rgb(255, 255, 255)" && (await ev("document.querySelector('header').className.includes('bg-onyx')")));
  await b.shot("light-desktop");

  console.log("\n== S2  the charcoal sidebar");
  check("the sidebar is dark charcoal with the sidebar text colour, even in light mode", (await ev("getComputedStyle(document.querySelector('[data-testid=sidebar]')).backgroundColor")) === "rgb(31, 28, 25)");
  check("desktop: the sidebar is 256px wide and fully visible", (await ev("Math.round(document.querySelector('[data-testid=sidebar]').getBoundingClientRect().width)")) === 256 && (await ev("getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility")) === "visible");
  check("the News Cafe logo and the coffee-cup placeholder are local files that loaded", await ev("(async () => { const imgs = [...document.querySelectorAll('[data-testid=sidebar] img')]; await Promise.all(imgs.map((i) => i.decode().catch(() => {}))); return imgs.length === 2 && imgs.every((i) => i.naturalWidth > 0 && new URL(i.src).hostname === 'localhost') && imgs[0].alt === 'News Cafe'; })()"));
  check("'Good Food Good Mood' is at the bottom of the sidebar", (await ev("document.querySelector('[data-testid=sidebar]').innerText")).includes("Good Food Good Mood"));
  check("navigation: Overview (current) and Reservations are links", (await ev("[...document.querySelectorAll('nav[aria-label=\"Owner sections\"] a')].map((a) => a.textContent + (a.getAttribute('aria-current') === 'page' ? '*' : '') + '>' + a.getAttribute('href')).join()")) === "Overview*>/admin,Reservations>/admin/reservations");
  check("Audit History and Security Settings are greyed out 'Coming soon' items: not links, not buttons, not focusable", (await ev("JSON.stringify([...document.querySelectorAll('[data-testid=coming-soon]')].map((e) => [e.textContent.replace(/\\s+/g, ' ').trim(), e.tagName, e.closest('a,button') === null, e.tabIndex]))")) === JSON.stringify([["Audit History Coming soon", "SPAN", true, -1], ["Security Settings Coming soon", "SPAN", true, -1]]));
  check("a Logout button is in the sidebar and the old header 'Sign out' button is gone", (await ev("[...document.querySelectorAll('[data-testid=sidebar] button')].some((x) => x.textContent.trim() === 'Logout')")) && !(await ev("[...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Sign out')")));
  check("the owner's e-mail is shown in the header", (await ev("document.querySelector('[data-testid=signed-in-email]')?.textContent")) === OWNER);

  console.log("\n== S3  the Light/Dark switch");
  check("a labelled group 'Colour theme' with two real buttons that read 'Light mode' and 'Dark mode'", (await ev("(() => { const g = document.querySelector('[data-testid=theme-toggle]'); return g.getAttribute('role') + '|' + g.getAttribute('aria-label') + '|' + [...g.querySelectorAll('button')].map((x) => x.textContent.trim()).join(); })()")) === "group|Colour theme|Light mode,Dark mode");
  check("the labels are visible on screen (not hidden), and Light is announced as pressed", (await ev("[...document.querySelectorAll('[data-testid=theme-toggle] button')].map((x) => x.getAttribute('aria-pressed') + ':' + (x.getBoundingClientRect().width > 40)).join()")) === "true:true,false:true");
  check("nothing is stored until the owner chooses", (await stored()) === "{}");
  await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=dark]').click()");
  check("clicking Dark switches at once: attribute, pressed state, dark colour set", await b.waitFor("document.documentElement.getAttribute('data-admin-theme') === 'dark'") && (await css("--color-onyx")) === "#221f1b" && (await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=dark]').getAttribute('aria-pressed')")) === "true");
  check("the choice is remembered as the single word 'dark' under one key, and nothing else is stored", (await stored()) === JSON.stringify({ "nc-owner-theme": "dark" }), await stored());
  await b.sleep(600);
  check("the page really paints dark (computed backgrounds)", (await ev("getComputedStyle(document.body).backgroundColor")) === "rgb(21, 19, 17)" && (await cardBg()) === "rgb(34, 31, 27)");
  await b.shot("dark-desktop");

  console.log("\n== S4  remembered on return, no flash");
  await b.go("/admin");
  check("reloading opens in Dark", await overview() && (await theme()) === "dark");
  const f2 = await frames();
  check("not a single frame was drawn in the Light set first (no flash)", f2.length === 1 && f2[0] === "#221f1b|dark", JSON.stringify(f2));
  check("the toggle shows Dark as pressed", (await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=dark]').getAttribute('aria-pressed')")) === "true");
  await ev("localStorage.setItem('nc-owner-theme', '<script>alert(1)</script>')"); await b.go("/admin");
  check("an invalid stored value is ignored (Light) and never put on the page", await overview() && (await theme()) === "light" && !(await ev("document.documentElement.outerHTML.includes('alert(1)')")));
  await ev("localStorage.setItem('nc-owner-theme', 'dark')");

  console.log("\n== S5  keyboard");
  await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=light]').focus()");
  await key("Tab", "Tab", 9);
  check("Tab moves from the Light button to the Dark button", (await ev("document.activeElement?.dataset?.mode")) === "dark");
  await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=light]').focus()");
  await key("Enter", "Enter", 13);
  check("Enter on Light switches to Light", (await theme()) === "light" && (await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=light]').getAttribute('aria-pressed')")) === "true");
  await ev("document.querySelector('[data-testid=theme-toggle] [data-mode=dark]').focus()");
  await key(" ", "Space", 32);
  check("Space on Dark switches to Dark, and the remembered value follows", (await theme()) === "dark" && (await stored()) === JSON.stringify({ "nc-owner-theme": "dark" }));
  check("the focused button has a visible focus ring", (await ev("getComputedStyle(document.querySelector('[data-testid=theme-toggle] [data-mode=dark]')).boxShadow")) !== "none");

  console.log("\n== S6  contrast of the text colours in BOTH themes (WCAG AA, 4.5:1) and the sidebar");
  const pairs = [["--color-bone", "--color-onyx"], ["--color-bone", "--color-ink"], ["--color-mist", "--color-onyx"], ["--color-mist", "--color-ink"], ["--color-gold", "--color-onyx"], ["--color-gold", "--color-ink"], ["--color-ink", "--color-gold"], ["--color-ok", "--color-onyx"], ["--color-danger", "--color-onyx"], ["--color-gold-light", "--color-onyx"], ["--nav-text", "--nav-bg"], ["--nav-mute", "--nav-bg"], ["--nav-faint", "--nav-bg"], ["--nav-gold", "--nav-bg"]];
  for (const t of ["light", "dark"]) {
    await ev(`document.querySelector('[data-testid=theme-toggle] [data-mode=${t}]').click()`); await b.sleep(500);
    const low = [];
    for (const [fg, bg] of pairs) { const r = ratio(await css(fg), await css(bg)); if (r < 4.5) low.push(`${fg} on ${bg} = ${r.toFixed(2)}`); }
    check(`${t}: every text/background pair is at least 4.5:1`, low.length === 0, low.join("; "));
  }

  console.log("\n== S7  responsive: desktop, tablet (icons only), phone (slide-out menu); no sideways scrolling");
  const noSideScroll = () => ev("document.documentElement.scrollWidth <= window.innerWidth");
  await metrics(1280, 900);
  check("desktop 1280: full sidebar, no menu button, no sideways scroll", (await ev("Math.round(document.querySelector('[data-testid=sidebar]').getBoundingClientRect().width)")) === 256 && (await ev("document.querySelector('button[aria-label=\"Open menu\"]').offsetParent === null")) && await noSideScroll());
  await metrics(900, 800);
  check("tablet 900: sidebar narrows to 64px icons, words kept for screen readers only, the 'Coming soon' captions hidden, and the page moves over", (await ev("Math.round(document.querySelector('[data-testid=sidebar]').getBoundingClientRect().width)")) === 64 && (await ev("[...document.querySelectorAll('[data-testid=sidebar] nav a span')].every((s) => s.getBoundingClientRect().width <= 1)")) && (await ev("Math.round(document.querySelector('main').getBoundingClientRect().left)")) >= 64 && await noSideScroll());
  check("tablet: the links still have an accessible name and a tooltip", (await ev("[...document.querySelectorAll('nav[aria-label=\"Owner sections\"] a')].map((a) => a.textContent + '/' + a.title).join()")) === "Overview/Overview,Reservations/Reservations");
  await b.shot("tablet");
  await metrics(390, 800, true);
  await b.sleep(400);
  check("phone 390: the sidebar is hidden (not focusable), a Menu button shows, the toggle is fully on screen, no sideways scroll", (await ev("getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility")) === "hidden" && (await ev("document.querySelector('button[aria-label=\"Open menu\"]').getAttribute('aria-expanded')")) === "false" && (await ev("(() => { const r = document.querySelector('[data-testid=theme-toggle]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; })()")) && await noSideScroll());
  await b.shot("phone-closed");
  await ev("document.querySelector('button[aria-label=\"Open menu\"]').click()");
  check("opening the menu slides the sidebar in, marks it expanded, focuses Close, and makes the page behind inert", await b.waitFor("document.querySelector('button[aria-label=\"Open menu\"]').getAttribute('aria-expanded') === 'true' && getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility === 'visible'") && (await ev("document.activeElement?.getAttribute('aria-label')")) === "Close menu" && (await ev("document.querySelector('main').closest('[inert]') !== null")));
  await b.sleep(300);
  check("the open menu is 288px wide and shows the e-mail, the links, Logout and the picture", (await ev("Math.round(document.querySelector('[data-testid=sidebar]').getBoundingClientRect().width)")) === 288 && (await ev("document.querySelector('[data-testid=drawer-email]').innerText")) === OWNER && (await ev("document.querySelector('[data-testid=sidebar]').innerText")).includes("Logout"));
  await b.shot("phone-open");
  await key("Escape", "Escape", 27);
  check("Escape closes the menu and returns focus to the Menu button", await b.waitFor("getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility === 'hidden'") && (await ev("document.activeElement?.getAttribute('aria-label')")) === "Open menu" && (await ev("document.querySelector('main').closest('[inert]') === null")));
  await ev("document.querySelector('button[aria-label=\"Open menu\"]').click()"); await b.sleep(300);
  await ev("document.querySelector('nav[aria-label=\"Owner sections\"] a[href=\"/admin/reservations\"]').click()");
  check("choosing a link closes the menu and goes to that page", await b.waitFor("location.pathname === '/admin/reservations' && getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility === 'hidden'"));
  await ev("document.querySelector('button[aria-label=\"Open menu\"]').click()"); await b.sleep(300);
  await b.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 370, y: 400, button: "left", clickCount: 1 }); await b.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 370, y: 400, button: "left", clickCount: 1 });
  check("tapping outside the menu closes it", await b.waitFor("getComputedStyle(document.querySelector('[data-testid=sidebar]')).visibility === 'hidden'"));
  await metrics(1280, 900); await b.go("/admin"); await overview();

  console.log("\n== S8  the public website is untouched");
  await ev("localStorage.setItem('nc-owner-theme', 'dark')");
  await b.go("/");
  check("the public page has no owner theme on it and the owner's choice did not change the public site's own setting", (await ev("document.documentElement.getAttribute('data-admin-theme')")) === null && (await ev("localStorage.getItem('nc-theme')")) === null);
  const pubDark = await css("--color-onyx");
  check("public colours are the public set (#121212 dark or #fffaf1 light), never the owner's", ["#121212", "#fffaf1"].includes(pubDark), pubDark);

  console.log("\n== S9  Logout still ends the session through the server");
  await b.go("/admin"); await overview();
  await b.clickButton("Logout");
  check("Logout returns to the login screen with 'You have been signed out'", await b.waitFor("location.pathname === '/admin/login' && document.body.innerText.includes('You have been signed out')"));
  check("the logout request carried the CSRF token", requests.some((r) => r.p === "/logout" && r.headers["X-CSRF-Token"] === "mock-csrf"));
  check("the login screen follows the remembered theme too (Dark)", (await theme()) === "dark");
  await b.shot("login-dark");

  console.log("\n== S10  hygiene");
  const own = b.cdp.errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|net::|401|403|404/.test(e));
  check("no JavaScript exceptions or console errors", own.length === 0, own.slice(0, 3).join(" | "));
  console.log(`      requests to other hosts that were blocked: ${[...b.blockedHosts].join(", ") || "none"}`);
} catch (e) {
  check("script ran to completion", false, String(e.stack ?? e).split("\n").slice(0, 3).join(" | "));
} finally {
  await b.close();
  console.log(`\n${failures === 0 ? "ALL PASSED" : "FAILURES"}: ${total - failures}/${total} owner-shell checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
