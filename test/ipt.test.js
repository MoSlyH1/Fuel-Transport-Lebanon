"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseIptHtml } = require("../lib/ipt");
const history = require("../lib/history");

// Shaped like the live page: menu text first, then the weekly price box.
const PAGE = `<html><head><title>Fuel Prices | IPT</title><script>var x="UNL 95 1 L.L."</script></head><body>
<nav><a>Our Stations</a><a>Fuel Prices</a></nav>
<div class="box"><h3>Weekly Fuel Prices</h3><span class="d">20 / 10 / 2026</span>
<table><tr><td>UNL 95</td><td><b>2,739,000</b> L.L.</td></tr>
<tr><td>UNL 98</td><td>2,757,000&nbsp;L.L.</td></tr>
<tr><td>Diesel</td><td>2,563,000 L.L.</td></tr>
<tr><td>Gas (LPG)</td><td>1,494,000 L.L.</td></tr></table></div></body></html>`;

test("parses the weekly box: date and the four products", () => {
  const r = parseIptHtml(PAGE);
  assert.equal(r.date, "2026-10-20");
  assert.deepEqual(r.prices, { unl95: 2_739_000, unl98: 2_757_000, diesel: 2_563_000, lpg: 1_494_000 });
});

test("returns null for a page without prices", () => {
  assert.equal(parseIptHtml("<html><body>Fuel Prices coming soon</body></html>"), null);
});

test("a bad date is ignored, prices still read", () => {
  const r = parseIptHtml(PAGE.replace("20 / 10 / 2026", "45 / 13 / 2026"));
  assert.equal(r.date, null);
  assert.equal(r.prices.unl95, 2_739_000);
});

test("history: live reading replaces seed; identical live reading is not a change", () => {
  const first = history.record("2026-10-20", { unl95: 2_739_000, unl98: 2_757_000, diesel: 2_563_000, lpg: 1_494_000 }, "IPT Group (live)");
  assert.equal(first.changed, false);   // same numbers as the seed
  assert.equal(first.write, true);      // but worth saving as a live copy
  const again = history.record("2026-10-20", { unl95: 2_739_000 }, "IPT Group (live)");
  assert.equal(again.write, false);     // nothing new; older fields kept
  const next = history.record("2026-10-23", { unl95: 2_700_000, unl98: 2_718_000, diesel: 2_500_000, lpg: 1_494_000 }, "IPT Group (live)");
  assert.deepEqual(next, { write: true, changed: true });
  assert.equal(history.all().find((t) => t.date === "2026-10-23").unl95, 2_700_000); // replaced the seed row
  assert.equal(history.all().at(-1).date, "2026-10-30");
  assert.equal(history.record("garbage", { unl95: 1 }, "x").write, false);
  assert.equal(history.record("2026-10-24", { unl95: 12 }, "x").write, false); // absurd quote rejected
});
