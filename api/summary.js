"use strict";
const { handler, parseQuery } = require("../lib/http");
const service = require("../lib/service");

// GET /api/summary?month=2026-10&days=26&employees=1 — prices + rate + month table
module.exports = handler(({ query }) => service.summary(parseQuery(query)));
