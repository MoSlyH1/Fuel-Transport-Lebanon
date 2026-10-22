"use strict";
const { handler } = require("../lib/http");
const db = require("../lib/db");

// GET /api/health — for Docker / uptime checks (does not touch the database)
module.exports = handler(() => ({ ok: true, database: db.enabled() ? "configured" : "not configured" }), {
  cache: "no-store",
});
