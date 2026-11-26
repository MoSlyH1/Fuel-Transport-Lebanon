"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED } = require("../lib/history");
const R = require("../lib/rules");

const tables = SEED.map(([date, unl95]) => ({ date, unl95 }));

test("October 2026: every calendar day (Sat & Sun included) carries the price in force — matches the government sheet", () => {
  const c = R.calculateMonth("2026-10", tables, "2026-11-25");
  assert.equal(c.status, "complete");
  assert.equal(c.mixed, true);
  assert.equal(c.avgDays, 31);
  assert.deepEqual(c.segments.map((s) => [s.tableDate, s.days]), [
    ["2026-09-30", 1], ["2026-10-02", 4], ["2026-10-06", 3], ["2026-10-09", 4], ["2026-10-13", 3],
    ["2026-10-16", 4], ["2026-10-20", 3], ["2026-10-23", 4], ["2026-10-27", 3], ["2026-10-30", 2]]);
  assert.equal(c.sumQuotes, 85_488_000);
  assert.equal(c.avgQuote20L, 85_488_000 / 31);
  assert.ok(Math.abs(c.rawPerDay - 689_419.35) < 0.01);
  assert.equal(c.roundTo, 1_000);
  assert.equal(c.roundedPerDay, 689_000);    // exact calculation, nearest 1,000
  assert.equal(c.calculatedRatePerDay, 689_000);
  assert.equal(c.official, 690_000);         // government's published rate
  assert.equal(c.ratePerDay, 690_000);       // final daily rate
  assert.equal(c.fuelRatePerDay, 690_000);
  assert.deepEqual([c.oldDays, c.newDays], [21, 10]);
});

test("a table counts for every day it stays in force (day-weighted, not once per table)", () => {
  const t = [{ date: "2026-10-01", unl95: 2_800_000 }, { date: "2026-10-30", unl95: 3_000_000 }];
  const c = R.calculateMonth("2026-10", t, "2026-11-05");
  assert.equal(c.count, 2);
  assert.equal(c.avgQuote20L, (2_800_000 * 29 + 3_000_000 * 2) / 31);
});

test("a new table is carried over the following days until the next one", () => {
  const t = [{ date: "2026-10-29", unl95: 2_844_000 }, { date: "2026-11-02", unl95: 2_837_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-11-30");
  assert.deepEqual(c.segments.map((s) => [s.tableDate, s.from, s.to, s.days]), [
    ["2026-10-29", "2026-11-01", "2026-11-01", 1], ["2026-11-02", "2026-11-02", "2026-11-30", 29]]);
  assert.equal(c.avgQuote20L, (2_844_000 + 2_837_000 * 29) / 30);
});

test("no new table in the month → the old price stands for every day", () => {
  const c = R.calculateMonth("2026-11", [{ date: "2026-10-29", unl95: 2_844_000 }], "2026-11-30");
  assert.equal(c.count, 1);
  assert.equal(c.avgDays, 30);
  assert.equal(c.avgQuote20L, 2_844_000);
});

test("the official October rate only replaces a WHOLE-month average", () => {
  const p = R.calculateMonth("2026-10", tables, "2026-10-22"); // 1–22 Oct only
  assert.equal(p.official, null);
  assert.equal(p.ratePerDay, 700_000);
  assert.equal(R.calculateMonth("2026-11", tables, "2026-11-30").official, null); // other months: calculated
});

test("current month is averaged day by day up to today", () => {
  const c = R.calculateMonth("2026-11", tables, "2026-11-11");
  assert.equal(c.status, "partial");
  assert.equal(c.averagedFrom, "2026-11-01");
  assert.equal(c.avgDays, 11);
  assert.equal(c.sumQuotes, 2_611_000 * 2 + 2_569_000 * 3 + 2_492_000 * 4 + 2_445_000 * 2);
  assert.equal(c.ratePerDay, 632_000);
});

test("rounding is to the nearest 1,000 in every month, October included", () => {
  assert.equal(R.roundToFor("2026-10"), 1_000);
  assert.equal(R.roundToFor("2026-11"), 1_000);
  assert.equal(R.rateFromAverageQuote(2_738_000).ratePerDay, 685_000); // 684,500 → up
  assert.equal(R.rateFromAverageQuote(2_737_000).ratePerDay, 684_000); // 684,250 → down
  assert.equal(R.rateFromAverageQuote(2_758_500).ratePerDay, 690_000); // 689,625
});

test("floor of 500,000 and cap of 800,000 apply", () => {
  const low = R.rateFromAverageQuote(1_400_000);
  assert.equal(low.ratePerDay, 500_000); assert.equal(low.clamped, "min");
  const high = R.rateFromAverageQuote(3_400_000);
  assert.equal(high.ratePerDay, 800_000); assert.equal(high.clamped, "max");
});

test("future month = latest price; months before the new terms = 450,000", () => {
  const f = R.calculateMonth("2026-12", tables.filter((x) => x.date <= "2026-10-22"), "2026-10-22");
  assert.equal(f.status, "future");
  assert.equal(f.segments[0].unl95, 2_739_000);
  assert.equal(f.ratePerDay, 685_000);
  const s = R.calculateMonth("2026-09", tables, "2026-10-22");
  assert.equal(s.legacy, true);
  assert.equal(s.ratePerDay, 450_000);
});

test("duplicate / null-price tables never create empty or broken days", () => {
  const t = [{ date: "2026-11-01", unl95: 2_000_000 }, { date: "2026-11-05", unl95: null }, { date: "2026-11-10", unl95: 2_100_000 }, { date: "2026-11-10", unl95: 2_200_000 }];
  const a = R.averageQuote(t, "2026-11-01", "2026-11-30");
  assert.equal(a.days, 30);
  assert.ok(a.segments.every((s) => s.days > 0));
  assert.equal(a.sum, 2_000_000 * 9 + 2_200_000 * 21);
});

test("date helpers", () => {
  assert.equal(R.lastOfMonth(2028, 2), "2028-02-29");
  assert.equal(R.addMonths("2026-12", 1), "2027-01");
  assert.ok(R.isMonth("2026-10") && !R.isMonth("2026-13"));
  assert.throws(() => R.calculateMonth("nope", tables, "2026-10-22"), RangeError);
  assert.equal(R.workingDays("2026-10-04", "2026-10-04"), 0);
});

test("payslip line", () => {
  const p = R.payslipLine(689_000, 26, 3);
  assert.equal(p.total, 53_742_000);
  assert.equal(p.differenceVsOld, (689_000 - 450_000) * 26 * 3);
});

test("monthly calculator: October whole month = same rate as the month table", () => {
  const c = R.calculatePeriod(undefined, tables, "2026-11-25", { month: "2026-10", newOnly: true });
  assert.equal(c.from, "2026-10-01");
  assert.equal(c.avgDays, 31);
  assert.equal(c.roundedPerDay, 689_000);
  assert.equal(c.ratePerDay, 690_000);
  assert.equal(c.rows[0].days, 26);
  assert.equal(c.avgPerDay, 690_000);
});

test("monthly calculator: starting on 22 Oct uses the whole-month average; 450K before", () => {
  const c = R.calculatePeriod("2026-10-22", tables, "2026-11-25", { month: "2026-10" });
  assert.equal(c.avgFrom, "2026-10-01");
  assert.equal(c.ratePerDay, 690_000);
  assert.deepEqual(c.rows.map((r) => [r.key, r.days, r.ratePerDay]), [["old", 18, 450_000], ["new", 8, 690_000]]);
});

test("monthly calculator: later month, previous rate = last month's fuel rate", () => {
  const c = R.calculatePeriod("2026-11-06", tables, "2026-11-11");
  assert.equal(c.first, "2026-11-01");
  assert.equal(c.oldRatePerDay, 690_000); // October's final rate
  assert.equal(c.avgDays, 6); // 6 → 11 Nov
  assert.equal(c.totalDays, 26);
  assert.throws(() => R.calculatePeriod(undefined, tables, "2026-11-11", { month: "2026-09" }), RangeError);
  assert.throws(() => R.calculatePeriod(undefined, tables, "2026-11-11", { month: "2026-12" }), RangeError);
});