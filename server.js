/* =====================================================================
   server.js — the Docker / local server.
   Serves public/ and runs the very same api/*.js handlers Vercel uses.
   Also re-reads IPT every 30 minutes so prices are recorded even when
   nobody has the page open.
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const service = require("./lib/service");
const db = require("./lib/db");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");

const routes = {
  "/api/summary": require("./api/summary"),
  "/api/prices": require("./api/prices"),
  "/api/rate": require("./api/rate"),
  "/api/refresh": require("./api/refresh"),
  "/api/health": require("./api/health"),
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.includes("\0")) { res.writeHead(400); return res.end(); }
  if (rel === "/") rel = "/index.html";

  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
      ...SECURITY_HEADERS,
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch { res.writeHead(400); return res.end(); }
  const api = routes[pathname];
  if (api) return api(req, res);
  if (pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unknown endpoint" }));
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Fuel & Transport running on http://localhost:${PORT}`);
  console.log(db.enabled() ? "[db] DATABASE_URL set — prices will be saved" : "[db] no DATABASE_URL — running from the built-in price history");
  // keep the history growing even with no visitors
  setTimeout(() => service.refresh().catch(() => {}), 2000).unref();
  setInterval(() => service.refresh().catch(() => {}), 30 * 60 * 1000).unref();
});

function shutdown() {
  server.close(() => db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
