"use strict";
const { handler } = require("../lib/http");
const service = require("../lib/service");

// GET /api/prices — the four official products
module.exports = handler(() => service.prices());
