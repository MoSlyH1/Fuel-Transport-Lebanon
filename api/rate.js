"use strict";
const { handler, parseQuery } = require("../lib/http");
const service = require("../lib/service");

// GET /api/rate?month=2026-10&days=26 — one month's rate with every step
module.exports = handler(({ query }) => service.rate(parseQuery(query)));
