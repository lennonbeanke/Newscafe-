// Shared helper for the browser tests: starts the Microsoft Edge that is already installed (headless, throw-away profile, DevTools on
// 127.0.0.1 only) and speaks the Chrome DevTools Protocol with Node 24's built-in WebSocket. No packages are installed.
// Every request to a host other than localhost/127.0.0.1 is blocked, and calls to /api/admin/* can be answered by a handler.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; this.errors = []; ws.addEventListener("message", (m) => this.onMessage(JSON.parse(m.data))); }
  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); if (msg.error) rej(new Error(msg.error.message)); else res(msg.result); }
    else for (const h of this.handlers) h(msg);
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(fn) { this.handlers.push(fn); }
}

/**
 * @param {{ port: number, outDir: string, site: string, mock?: (req: {method: string, url: URL, body: string|null, headers: Record<string,string>}) => ({status: number, json?: unknown, headers?: Record<string,string>} | null) }} o
 * `mock` answers /api/admin/* itself (return null to let the request through to the real server).
 */
export async function openBrowser({ port, outDir, site, mock }) {
  mkdirSync(outDir, { recursive: true });
  const profile = `${outDir}/edge-profile-${port}`;
  const edge = spawn(EDGE, [
    "--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update",
    "--disable-default-apps", "--disable-features=Translate,OptimizationHints,MediaRouter", "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" });
  const getJson = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();
  for (let i = 0; i < 60; i++) { try { await getJson("/json/version"); break; } catch { await sleep(250); } }
  const version = await getJson("/json/version");
  const page = (await getJson("/json/list")).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const blockedHosts = new Set();
  cdp.on(async (m) => {
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      const u = new URL(request.url);
      const local = ["localhost", "127.0.0.1"].includes(u.hostname) || u.protocol === "data:" || u.protocol === "blob:";
      if (!local) { blockedHosts.add(u.hostname); await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {}); return; }
      if (mock && u.pathname.startsWith("/api/admin/")) {
        const answer = mock({ method: request.method, url: u, body: request.postData ?? null, headers: request.headers ?? {} });
        if (answer) {
          if (answer.delayMs) await sleep(answer.delayMs);
          await cdp.send("Fetch.fulfillRequest", {
            requestId, responseCode: answer.status,
            responseHeaders: Object.entries({ "content-type": "application/json", "cache-control": "no-store", ...(answer.headers ?? {}) }).map(([name, value]) => ({ name, value })),
            body: Buffer.from(JSON.stringify(answer.json ?? {})).toString("base64"),
          }).catch(() => {});
          return;
        }
      }
      await cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
    if (m.method === "Page.javascriptDialogOpening") await cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (m.method === "Runtime.exceptionThrown") cdp.errors.push(`exception: ${(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").split("\n").slice(0, 6).join(" ; ")} [page ${m.params.exceptionDetails?.url ?? ""}]`);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(m.params.type)) cdp.errors.push(`console.${m.params.type}: ${(m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160)}`);
  });
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "evaluate failed");
    return r.result.value;
  };
  const waitFor = async (expression, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (await evaluate(expression)) return true; } catch { /* page is navigating */ } await sleep(120); }
    return false;
  };
  let shotNo = 0;
  return {
    cdp, version: version.Browser, blockedHosts, evaluate, waitFor, sleep,
    text: () => evaluate("document.body.innerText"),
    url: () => evaluate("location.pathname + location.search"),
    async go(path) { await cdp.send("Page.navigate", { url: `${site}${path}` }); await sleep(300); await waitFor("document.readyState === 'complete'"); },
    /** Sets a text/date/textarea field the way a person typing would (React sees an input event). */
    setField: (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`),
    setSelect: (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`),
    clickButton: (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`),
    async shot(name) {
      await sleep(250);
      const r = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = `${outDir}/${String(++shotNo).padStart(2, "0")}-${name}.png`;
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`      screenshot: ${file}`);
    },
    async close() {
      try { await cdp.send("Browser.close"); } catch { /* closing */ }
      await sleep(800);
      try { edge.kill(); } catch { /* already gone */ }
      await sleep(500);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}
