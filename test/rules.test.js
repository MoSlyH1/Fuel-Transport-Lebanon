"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED } = require("../lib/history");
const R = require("../lib/rules");

const tables = SEED.map(([date, unl95]) => ({ date, unl95 }));

test("October 2026: 450,000 before the 22nd, fuel average from the 22nd", () => {
  const c = R.calculateMonth("2026-10", tables, "2026-10-22");
  assert.equal(c.status, "partial");
  assert.equal(c.legacy, false);
  assert.equal(c.mixed, true);
  assert.equal(c.days, 1); // only 22 Oct is averaged so far
  assert.deepEqual(c.segments.map((s) => [s.from, s.to, s.days, s.unl95]), [
    ["2026-10-22", "2026-10-22", 1, 2_739_000],
  ]);
  assert.equal(c.avgQuote20L, 2_739_000);
  assert.equal(c.rawPerDay, 684_750);
  assert.equal(c.fuelRatePerDay, 685_000);
  assert.deepEqual([c.oldDays, c.newDays], [21, 10]);
  assert.equal(c.ratePerDay, Math.round((21 * 450_000 + 10 * 685_000) / 31)); // 525,806
  assert.equal(c.clamped, null);
  const p = R.payslipLine(c.ratePerDay, 26);
  assert.equal(p.total, 13_670_956);
});

test("segment days always add up to the days averaged", () => {
  const c = R.calculateMonth("2026-10", tables, "2026-10-28");
  assert.equal(c.segments.reduce((a, s) => a + s.days, 0), c.days);
  assert.equal(c.segments.reduce((a, s) => a + s.days * s.unl95, 0), c.sumQuoteDays);
});

test("a finished October averages only 22–31 Oct, including a mid-period price change", () => {
  const t = [{ date: "2026-10-01", unl95: 2_800_000 }, { date: "2026-10-26", unl95: 3_000_000 }];
  const c = R.calculateMonth("2026-10", t, "2026-11-05");
  assert.equal(c.status, "complete");
  assert.equal(c.days, 10);
  assert.deepEqual(c.segments.map((s) => [s.from, s.days]), [["2026-10-22", 4], ["2026-10-26", 6]]);
  assert.equal(c.avgQuote20L, (2_800_000 * 4 + 3_000_000 * 6) / 10);
});

test("a full month after the start date is entirely fuel-indexed (no mixing)", () => {
  const t = [{ date: "2026-10-22", unl95: 2_800_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-12-05");
  assert.equal(c.mixed, false);
  assert.equal(c.days, 30);
  assert.equal(c.ratePerDay, 700_000);
});

test("price in force before the month starts carries into day 1", () => {
  const t = [{ date: "2026-10-29", unl95: 2_844_000 }, { date: "2026-11-02", unl95: 2_837_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-11-03");
  assert.equal(c.segments[0].tableDate, "2026-10-29");
  assert.equal(c.segments[0].days, 1);
});

test("floor of 500,000 and cap of 800,000 apply", () => {
  const low = R.rateFromAverageQuote(1_800_000);   // 450,000 raw
  assert.equal(low.ratePerDay, 500_000);
  assert.equal(low.clamped, "min");
  const high = R.rateFromAverageQuote(3_400_000);  // 850,000 raw
  assert.equal(high.ratePerDay, 800_000);
  assert.equal(high.clamped, "max");
  assert.equal(R.rateFromAverageQuote(2_800_000).ratePerDay, 700_000);
});

test("rounds to the nearest 1,000 (half rounds up)", () => {
  assert.equal(R.rateFromAverageQuote(2_738_000).ratePerDay, 685_000); // 684,500
  assert.equal(R.rateFromAverageQuote(2_739_000).ratePerDay, 685_000); // 684,750
  assert.equal(R.rateFromAverageQuote(2_737_000).ratePerDay, 684_000); // 684,250
});

test("future month = estimate from the latest price; days are not invented", () => {
  const c = R.calculateMonth("2026-12", tables, "2026-10-22");
  assert.equal(c.status, "future");
  assert.equal(c.days, 1);
  assert.equal(c.segments[0].unl95, 2_739_000);
  assert.equal(c.ratePerDay, 685_000);
});

test("months before the 22 Oct 2026 start use the old fixed 450,000", () => {
  const c = R.calculateMonth("2026-09", tables, "2026-10-22");
  assert.equal(c.legacy, true);
  assert.equal(c.ratePerDay, 450_000);
});

test("date helpers", () => {
  assert.equal(R.lastOfMonth(2026, 2), "2026-02-28");
  assert.equal(R.lastOfMonth(2028, 2), "2028-02-29");
  assert.equal(R.addMonths("2026-12", 1), "2027-01");
  assert.equal(R.addMonths("2026-10", 3), "2027-01");
  assert.equal(R.monthLabel("2026-10"), "October 2026");
  assert.ok(R.isMonth("2026-10") && !R.isMonth("2026-13") && !R.isMonth("2026-1"));
  assert.throws(() => R.calculateMonth("nope", tables, "2026-10-22"), RangeError);
});

test("employees multiply the payslip line", () => {
  const p = R.payslipLine(700_000, 26, 3);
  assert.equal(p.total, 54_600_000);
  assert.equal(p.differenceVsOld, 19_500_000);
  assert.equal(R.payslipLine(700_000, 0, 1).total, 0);
});