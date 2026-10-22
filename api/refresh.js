"use strict";
const { handler } = require("../lib/http");
const service = require("../lib/service");

// GET|POST /api/refresh — read IPT now (throttled to once a minute).
// Vercel's daily cron calls this too (see vercel.json).
module.exports = handler(() => service.forceRefresh(), {
  methods: ["GET", "POST"],
  cache: "no-store",
});
