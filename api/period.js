"use strict";
const { handler, parseQuery } = require("../lib/http");
const service = require("../lib/service");

// GET /api/period?from=2026-10-09 — the October calculator (old rate before `from`, fuel rate from `from`)
module.exports = handler(({ query }) => service.period(parseQuery(query)));
