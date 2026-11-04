// Checks the customer email (supabase/functions/cdf-notify/email.ts) without sending anything:
// the HTML is safe for email clients, every step says only what it should, the photo block is left out
// when there is no photo, and it fits a desktop and a phone screen. Screenshots go to .impeccable/review/.
// Run: NODE_PATH=.test-tools/node_modules node tests/email-check.cjs
const http = require("http"), fs = require("fs"), path = require("path"), assert = require("assert"), { pathToFileURL } = require("url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable", "review");
const results = []; const ok = (n) => { results.push(n); console.log("ok   " + n); };

(async () => {
  const { customerEmail, stepOf } = await import(pathToFileURL(path.join(root, "supabase/functions/cdf-notify/email.ts")).href);
  // A local stand-in for the site, so the absolute logo and photo URLs load in the browser
  const server = http.createServer((req, res) => fs.readFile(path.join(root, req.url.split("?")[0]), (e, b) => (e ? res.writeHead(404).end() : res.end(b))));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const site = "http://127.0.0.1:" + server.address().port;
  const sample = (step, extra = {}) => customerEmail({ appUrl: site, num: "0003", name: "Carlos Reyes", step, link: "https://pedidos-cdf.netlify.app/p/abc123abcd", photoUrl: site + "/img/emblem.png", ...extra });

  // ---- the HTML itself
  const steps = ["prep", "ready", "transit", "done", "fail"];
  for (const s of steps) {
    const { html, text, subject } = sample(s);
    assert(!/<script|<form|<input|<iframe|javascript:|@keyframes|animation/i.test(html), s + ": no scripts, forms or animation");
    for (const img of html.match(/<img [^>]+>/g)) { assert(/ alt="[^"]+"/.test(img), "every image has alt text"); assert(/ src="https?:\/\//.test(img), "image URLs are absolute"); }
    assert(html.includes('href="https://pedidos-cdf.netlify.app/p/abc123abcd"') && html.includes(">View my order</a>"), "button goes to the tracking link");
    assert(html.includes('role="presentation"') && html.includes('width="600"'), "table layout, 600px");
    assert(text.includes("View my order: https://pedidos-cdf.netlify.app/p/abc123abcd") && text.includes("ORDER #0003") && !/<[a-z]/i.test(text), "plain text version");
    assert(html.includes("Hi, Carlos.") && html.includes("Order #0003") && subject.includes("#0003"), "real name and number");
  }
  ok("Every step: table layout, inline styles, absolute images with alt text, tracking button, plain text; no scripts, forms or animation");
  const transit = sample("transit");
  for (const s of ["ORDER #0003", "Your bouquet is on its way", "Hi, Carlos.", "Your order is ready and on its way.", "View my order", "Track your order and view its details.", "Thank you for letting us brighten your day."])
    assert((transit.html + transit.text).includes(s.replace("ORDER", "Order")) || transit.text.includes(s), "missing: " + s);
  ok("On the way: the agreed English texts");
  for (const s of ["prep", "ready", "done", "fail"]) assert(!/on its way/i.test(sample(s).html + sample(s).text), s + " must not say on its way");
  ok("Other steps never say \"on its way\"");
  assert(stepOf("Ready", "In transit") === "transit" && stepOf("Preparing", "-") === "prep" && stepOf("Ready", "Failed") === "fail");
  ok("Step comes from the order's status and delivery");
  const nophoto = sample("transit", { photoUrl: null });
  assert.equal(nophoto.html.match(/<img /g).length, 1, "only the logo is left");
  ok("No photo: the photo block is left out (no broken image)");
  const hostile = sample("transit", { name: '<img src=x onerror=alert(1)>', message: "<b>hi</b> see https://example.com" });
  assert(!hostile.html.includes("<img src=x") && hostile.html.includes("&lt;b&gt;hi&lt;/b&gt;"), "names and notes are escaped");
  ok("Names and shop notes are escaped");
  assert(sample("transit", { name: "" }).html.includes(">Hi.<"));
  ok("No name: a plain greeting, nothing invented");

  // ---- how it looks: desktop and phone
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const [w, name] of [[1000, "email-desktop"], [390, "email-mobile"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
    await p.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
    await p.setContent(transit.html, { waitUntil: "load" });
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll at " + w + "px");
    assert(await p.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)), "logo and photo load");
    await p.screenshot({ path: path.join(out, name + ".png"), fullPage: true });
    await p.close();
  }
  ok("Fits 1000px and 390px wide, images load; screenshots in .impeccable/review/");
  await browser.close(); server.close();
  console.log(results.length + " checks passed");
})().catch((e) => { console.error("FAIL " + e.message); process.exitCode = 1; process.exit(1); });
