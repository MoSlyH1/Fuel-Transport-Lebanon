/* =====================================================================
   server.js — the Docker / local server (Vercel uses api/*.js directly)
     /api/<name>   → api/<name>.js   (the same handler files Vercel runs)
     everything else → a file from public/ (index.html for "/")
   ===================================================================== */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");

const API = {
  health: require("./api/health"),
  prices: require("./api/prices"),
  rate: require("./api/rate"),
  summary: require("./api/summary"),
  period: require("./api/period"),
  closing: require("./api/closing"),
  refresh: require("./api/refresh"),
};

// same page as "/" (the no-ad full-access link) — keep in step with vercel.json
const REWRITES = { "/fullaccesstopage": "/index.html" };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function plain(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY });
  res.end(text);
}

function serveStatic(req, res, rawPath) {
  if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "Method not allowed");
  if (/%2e|%2f|%5c|\\/i.test(rawPath) || rawPath.split("/").includes("..")) return plain(res, 403, "Forbidden");
  let p;
  try { p = decodeURIComponent(rawPath); } catch { return plain(res, 400, "Bad request"); }
  if (p.includes("\0")) return plain(res, 400, "Bad request");
  if (REWRITES[p]) p = REWRITES[p];
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC + path.sep)) return plain(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return plain(res, 404, "Not found");
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type, "Content-Length": st.size, ...SECURITY,
      "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=300",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const rawPath = (req.url || "/").split("?")[0];
  if (rawPath.includes("%00")) return plain(res, 400, "Bad request");
  const m = /^\/api\/([a-z]+)\/?$/.exec(rawPath);
  if (m) {
    const h = API[m[1]];
    if (!h) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...SECURITY });
      return res.end(JSON.stringify({ error: "Not found" }));
    }
    // the two Vercel helpers api/refresh.js uses
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => {
      for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
      return res;
    };
    return h(req, res);
  }
  if (rawPath.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", ...SECURITY });
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  return serveStatic(req, res, rawPath);
});

server.listen(PORT, () => console.log(`[fuel] listening on http://localhost:${PORT}`));

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);