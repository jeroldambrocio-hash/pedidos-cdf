// Statistics only for chosen admins: the tab, the Team switch, and who may change it.
// NODE_PATH=.test-tools/node_modules node tests/stats-access-ui.cjs
// (harness from: Phase 5, browser: the proofs under the Lalamove block (pending, available, not provided, error,
// removed), still shown after delivery and after the order is cancelled; viewing through a short-lived
// link; removing (admins only); the replaced-booking notes. Fake Supabase of ui-smoke.cjs, no network.
// NODE_PATH=.test-tools/node_modules node tests/lalamove-proofs-ui.cjs  (screenshots in .impeccable/review/llproofs-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-stats.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let name = req.url.split("?")[0];
  if (name === "/") name = "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(f, (e, b) => {
    if (e) return res.writeHead(404).end();
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    res.end(f.endsWith(".html") ? String(b).replace(/ integrity="[^"]+"/g, "") : b);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, channel: "chrome" }), errors = [];
  const open = async (role, width, members) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-PH", reducedMotion: "reduce" });
    await ctx.addInitScript(([r, ms]) => { window.__role = r; try { localStorage.setItem("cdf-lang", "en"); sessionStorage.setItem("__members", JSON.stringify(ms)); } catch {} }, [role, members]);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (!u.startsWith("http://127.0.0.1")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.locator("#list").waitFor({ state: "visible" });
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: path.join(out, "llproofs-" + n + ".png") });
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  const team = (me) => [{ email: "admin@example.com", name: "Jerold", role: "admin", sees_stats: me },
    { email: "boss2@example.com", name: "Maria", role: "admin", sees_stats: false }, { email: "boss3@example.com", name: "Rosa", role: "admin", sees_stats: true },
    { email: "ana@example.com", name: "Ana", role: "vendor", sees_stats: true }];
  const editOf = async (p, name) => { await p.locator(".member", { hasText: name }).getByRole("button", { name: "Edit" }).click(); await p.locator("#eTitle").waitFor(); };
  try {
    // An admin with Statistics: sees the tab, and chooses for the other admins
    const p = await open("admin", 1280, team(true));
    assert.equal(await p.locator("#tabStats").isVisible(), true);
    await p.locator("#tabTeam").click(); await p.locator("#teamView:not([hidden])").waitFor();
    assert.match(await p.locator(".member", { hasText: "Maria" }).innerText(), /No access to Statistics/);
    await editOf(p, "Maria");
    assert.equal(await p.locator("#eStats").isChecked(), false);
    await p.locator("#eStatsRow").click();
    await p.locator(".dialog button[type=submit]").click();
    await p.locator("#eTitle").waitFor({ state: "detached" });
    const upd = (await p.evaluate(() => window.__calls)).filter((c) => c.table === "cdf_members" && c.action === "update");
    assert.equal(upd.at(-1)?.row?.sees_stats, true, "sent: " + JSON.stringify(upd.at(-1)));
    await editOf(p, "Jerold");
    assert.equal(await p.locator("#eStats").isDisabled(), true, "not your own");
    await p.keyboard.press("Escape");
    await editOf(p, "Ana");
    assert.equal(await p.locator("#eStatsRow").isHidden(), true, "only for admins");
    await p.locator("#eRole").selectOption("admin");
    assert.equal(await p.locator("#eStatsRow").isVisible(), true, "appears when made admin");
    await p.keyboard.press("Escape");
    await p.context().close();
    console.log("ok an admin with Statistics sees the tab and switches it per admin in Team; not their own; only for admins");

    // An admin without Statistics: no tab, no way to reach it, no switch
    const q = await open("admin", 1280, team(false));
    assert.equal(await q.locator("#tabStats").isHidden(), true);
    await q.evaluate(() => setTab("stats"));
    assert.equal(await q.evaluate(() => S.tab), "orders", "can't be opened another way");
    assert.equal(await q.locator("#statsView").isHidden(), true);
    await q.locator("#tabTeam").click(); await q.locator("#teamView:not([hidden])").waitFor();
    await editOf(q, "Rosa");
    assert.equal(await q.locator("#eStats").count(), 0, "can't choose for others");
    await q.keyboard.press("Escape");
    await q.context().close();
    console.log("ok an admin without Statistics has no tab, can't open it, and can't change anyone's access");

    // Before the migration (no column): everything as today
    const r = await open("admin", 1280, [{ email: "admin@example.com", name: "Jerold", role: "admin" }, { email: "boss2@example.com", name: "Maria", role: "admin" }]);
    assert.equal(await r.locator("#tabStats").isVisible(), true);
    await r.locator("#tabTeam").click(); await r.locator("#teamView:not([hidden])").waitFor();
    await editOf(r, "Maria");
    assert.equal(await r.locator("#eStats").count(), 0);
    await r.context().close();
    console.log("ok without the migration nothing changes");
    assert.deepEqual(errors, []);
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
