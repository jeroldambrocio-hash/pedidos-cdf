// Team: adding someone whose email is already in the team is refused (not overwritten); a new email still
// goes to the cdf-users function. Fake Supabase of ui-smoke.cjs.
// NODE_PATH=.test-tools/node_modules node tests/team-add-ui.cjs
// (was: Phase 5, browser: the proofs under the Lalamove block (pending, available, not provided, error,
// removed), still shown after delivery and after the order is cancelled; viewing through a short-lived
// link; removing (admins only); the replaced-booking notes. Fake Supabase of ui-smoke.cjs, no network.
// NODE_PATH=.test-tools/node_modules node tests/lalamove-proofs-ui.cjs  (screenshots in .impeccable/review/llproofs-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-team.js");
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
  const open = async (role, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-ES", reducedMotion: "reduce" });
    await ctx.addInitScript((r) => { window.__role = r; try { localStorage.setItem("cdf-lang", "es"); } catch {} }, role);
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
    await p.evaluate(() => { window.__inv = []; const inv = sb.functions.invoke.bind(sb.functions); sb.functions.invoke = async (name, opts) => { __inv.push({ name, body: opts.body }); return { data: { ok: true, existed: false }, error: null }; }; });
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: path.join(out, "llproofs-" + n + ".png") });
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  try {
    const p = await open("admin", 1280);
    await p.locator("#tabTeam").click();
    await p.locator("#teamView:not([hidden])").waitFor();
    const taken = await p.evaluate(() => S.members.find((m) => m.email !== S.me.email));
    await p.locator("#aName").fill("Someone Else");
    await p.locator("#aEmail").fill(taken.email.toUpperCase());
    await p.locator("#aPass").fill("longpassword1");
    await p.locator("#aBtn").click();
    await p.locator("#aErr").filter({ hasText: taken.name }).waitFor();
    assert.match(await p.locator("#aErr").innerText(), /already a member|Ya existe/);
    assert.deepEqual(await p.evaluate(() => __inv), [], "nothing sent");
    assert.equal(await p.evaluate((e) => S.members.find((m) => m.email === e).name, taken.email), taken.name, "the member is unchanged");
    console.log("ok an email already in the team is refused with the member's name; nothing is sent or overwritten");

    await p.locator("#aEmail").fill("new.person@example.com");
    await p.locator("#aBtn").click();
    await p.waitForFunction(() => __inv.length === 1);
    const call = await p.evaluate(() => __inv[0]);
    assert.equal(call.name, "cdf-users"); assert.equal(call.body.email, "new.person@example.com");
    console.log("ok a new email is still added through cdf-users");

    // The server says it (another admin added them meanwhile): the same message
    await p.evaluate(() => { sb.functions.invoke = async () => ({ data: null, error: { context: { json: async () => ({ error: "x", code: "email_taken", name: "Maria" }) } } }); });
    await p.locator("#aName").fill("Maria Two"); await p.locator("#aEmail").fill("maria@example.org"); await p.locator("#aPass").fill("longpassword1");
    await p.locator("#aBtn").click();
    await p.locator("#aErr").filter({ hasText: "Maria" }).waitFor();
    console.log("ok when the server refuses it, the same message shows");
    assert.deepEqual(errors, []);
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
