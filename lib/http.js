/* =====================================================================
   http.js — tiny wrapper so the SAME handler files run on Vercel
   (api/*.js) and inside the Docker server (server.js).
   Uses only plain Node req/res, nothing Vercel- or Express-specific.
   ===================================================================== */
"use strict";

const { isMonth } = require("./rules");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(req, res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(req.method === "HEAD" ? undefined : json);
}

/**
 * @param {(ctx:{req, query:Object}) => Promise<object>} fn
 * @param {{methods?: string[], cache?: string}} [opts]
 */
function handler(fn, { methods = ["GET", "HEAD"], cache = "public, max-age=0, s-maxage=30" } = {}) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader("Allow", methods.join(", "));
        return send(req, res, 405, { error: "Method not allowed" });
      }
      const url = new URL(req.url, "http://localhost");
      const data = await fn({ req, query: Object.fromEntries(url.searchParams) });
      return send(req, res, 200, data, { "Cache-Control": cache });
    } catch (e) {
      if (e instanceof HttpError) return send(req, res, e.status, { error: e.message });
      console.error("[api] error:", e);
      return send(req, res, 500, { error: "Something went wrong. Please try again." });
    }
  };
}

/** ?month=2026-10&days=26&employees=3 → validated numbers (all optional). */
function parseQuery(q) {
  const out = {};
  if (q.month != null && q.month !== "") {
    if (!isMonth(q.month)) throw new HttpError(400, "month must look like 2026-10");
    out.month = q.month;
  }
  if (q.days != null && q.days !== "") {
    if (!/^\d{1,2}$/.test(q.days) || Number(q.days) > 31) throw new HttpError(400, "days must be a whole number from 0 to 31");
    out.days = Number(q.days);
  }
  if (q.employees != null && q.employees !== "") {
    if (!/^\d{1,5}$/.test(q.employees) || Number(q.employees) < 1) throw new HttpError(400, "employees must be a whole number from 1 to 99999");
    out.employees = Number(q.employees);
  }
  return out;
}

module.exports = { handler, parseQuery, HttpError };
