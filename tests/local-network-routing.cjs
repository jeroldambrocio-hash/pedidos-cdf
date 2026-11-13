// Test-only adapter for environments that block loopback sockets. Existing test
// route handlers still run; only their localhost continue() reads the same files.
const fs = require("node:fs"), path = require("node:path"), { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), launch = chromium.launch.bind(chromium);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
chromium.launch = async (...args) => {
  const browser = await launch(...args), newContext = browser.newContext.bind(browser);
  browser.newContext = async (...opts) => {
    const ctx = await newContext(...opts), register = ctx.route.bind(ctx);
    // Chromium fetches service-worker scripts outside page routing. Tests already
    // replace PushManager; provide only their local registration plumbing here.
    await ctx.addInitScript(() => {
      if (!navigator.serviceWorker || !window.PushManager) return;
      const reg = { pushManager: Object.create(PushManager.prototype) };
      Object.defineProperties(navigator.serviceWorker, {
        register: { value: async () => reg, configurable: true },
        getRegistration: { value: async () => reg, configurable: true },
        ready: { get: () => Promise.resolve(reg), configurable: true }
      });
    });
    ctx.route = (pattern, handler, ...rest) => register(pattern, async (route, request) => {
      const url = new URL(request.url());
      if (url.hostname === "127.0.0.1") route.continue = async () => {
        const filename = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
        if (!filename.startsWith(root + path.sep)) return route.fulfill({ status: 403, body: "" });
        try {
          let body = fs.readFileSync(filename);
          if (filename.endsWith(".html")) body = String(body).replace(/ integrity="[^"]+"/g, "");
          return route.fulfill({ status: 200, body, contentType: (mime[path.extname(filename)] || "text/plain") + "; charset=utf-8" });
        } catch { return route.fulfill({ status: 404, body: "" }); }
      };
      return handler(route, request);
    }, ...rest);
    return ctx;
  };
  return browser;
};
