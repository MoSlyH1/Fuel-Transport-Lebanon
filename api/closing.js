"use strict";
const { handler, parseQuery } = require("../lib/http");
const service = require("../lib/service");

// GET /api/closing?month=2026-11&day=24 — the closing-day calculator: the price in force on the
// closing day is carried to the end of the month (later tables are not counted), then the month is averaged.
module.exports = handler(({ query }) => service.closing(parseQuery(query)));