const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), mockFile = path.join(root, ".impeccable", "audit-mock.js");
fs.mkdirSync(path.dirname(mockFile), { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const ctx = await browser.newContext(), errors = [];
    await ctx.addInitScript(() => { window.__role = "admin"; });
    await ctx.route("**/*", route => {
      const url = route.request().url();
      if (url.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (url.startsWith("http://127.0.0.1")) return route.continue();
      return route.fulfill({ body: "", contentType: "text/plain" });
    });
    const page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.stack));
    await page.goto("http://127.0.0.1:31415/"); await page.locator("#list").waitFor({ state: "visible" });
    await page.evaluate(async () => {
      window.__originalFrom = sb.from.bind(sb);
      sb.from = table => {
        if (table !== "cdf_request_files") return __originalFrom(table);
        const q = { select: () => q, eq: () => q, order: () => q,
          then: (ok, fail) => Promise.resolve({ data: null, error: { code: "400" } }).then(ok, fail) };
        return q;
      };
      S.cap.requests = true;
      await openRequest({ id: "audit-request", status: "in_review" });
    });
    assert.equal(await page.locator(".req-sheet").count(), 0);
    assert.equal(await page.locator(".toast.error").count(), 1);
    console.log("ok request files failure blocks an incomplete review and offers retry");
    await page.evaluate(() => document.body.append(requestPhotos({ id: "audit-request" })));
    await page.locator(".req-on-order .err").waitFor();
    await page.evaluate(() => { sb.from = __originalFrom; });
    await page.locator(".req-on-order button").click();
    await page.waitForFunction(() => document.querySelector(".req-on-order").hidden);
    console.log("ok failed references show an error; retry clears it when the server confirms an empty result");
    const refreshes = await page.evaluate(() => {
      let n = 0; const original = loadOrders, requests = loadRequests, chat = catchUpChat;
      loadOrders = async () => { n++; }; loadRequests = async () => {}; catchUpChat = async () => {};
      S.channel = { state: "joined" }; S.loadError = false;
      let hidden = true; Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange")); hidden = false;
      document.dispatchEvent(new Event("visibilitychange")); const healthy = n;
      S.channel.state = "closed"; document.dispatchEvent(new Event("visibilitychange"));
      loadOrders = original; loadRequests = requests; catchUpChat = chat;
      delete document.hidden; return { healthy, disconnected: n };
    });
    assert.equal(refreshes.healthy, 0); assert.equal(refreshes.disconnected, 1);
    console.log("ok brief foreground return keeps a healthy list; disconnected channel reconciles");
    const push = await page.evaluate(async () => {
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
      const original = linkDevice;
      linkDevice = async () => { throw Object.assign(new Error("schema mismatch"), { code: "PGRST204" }); };
      await syncPush();
      const failed = PWA.syncError?.code;
      linkDevice = async () => {};
      await syncPush();
      const recovered = PWA.syncError === null;
      linkDevice = original;
      return { failed, recovered };
    });
    assert.equal(push.failed, "PGRST204"); assert.equal(push.recovered, true);
    console.log("ok push registration failure is visible and a successful retry clears the error");
    const riders = await page.evaluate(async () => {
      const original = sb.from.bind(sb), detect = llDetect;
      const rows = Array.from({ length: 1005 }, (_, i) => ({ id: "audit-" + i }));
      const records = rows.map(o => ({ order_id: o.id, ll_order_id: o.id, price_total: 1, status: "COMPLETED" }));
      let queries = 0;
      llDetect = async () => "ready";
      sb.from = table => {
        if (table !== "cdf_lalamove") return original(table);
        let selected = records, from = 0;
        const q = { select: () => q, order: () => q,
          in: (_, ids) => { selected = records.filter(r => ids.includes(r.order_id)); return q; },
          range: (a) => { from = a; return q; },
          then: (ok, fail) => { queries++; return Promise.resolve({ data: selected.slice(from, from + 37), count: selected.length, error: null }).then(ok, fail); }
        }; return q;
      };
      const card = await ridersCard(rows, () => 0, false, (...args) => args);
      sb.from = original; llDetect = detect;
      return { text: card[2].textContent, queries };
    });
    assert.match(riders.text, /1,005/); assert(riders.queries > 6);
    console.log("ok rider totals include 1005 bookings even when the API returns only 37 rows per page");
    assert.deepEqual(errors, []);
    console.log("ok no uncaught browser errors");
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
