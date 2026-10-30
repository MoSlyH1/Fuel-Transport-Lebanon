"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SEED } = require("../lib/history");
const R = require("../lib/rules");

const tables = SEED.map(([date, unl95]) => ({ date, unl95 }));

test("October 2026 with only the 20 Oct table: 2,739,000 → 685,000", () => {
  const t = tables.filter((x) => x.date <= "2026-10-22");
  const c = R.calculateMonth("2026-10", t, "2026-10-22");
  assert.equal(c.status, "partial");
  assert.equal(c.legacy, false);
  assert.equal(c.mixed, true);
  assert.equal(c.count, 1);
  assert.deepEqual(c.segments.map((s) => [s.tableDate, s.unl95]), [["2026-10-20", 2_739_000]]);
  assert.equal(c.avgQuote20L, 2_739_000);
  assert.equal(c.rawPerDay, 684_750);
  assert.equal(c.fuelRatePerDay, 685_000);
  assert.deepEqual([c.oldDays, c.newDays], [21, 10]);
  assert.equal(c.ratePerDay, 685_000);
  assert.equal(c.clamped, null);
});

test("20 Oct + 23 Oct tables: (2,739,000 + 2,686,000) ÷ 2 ÷ 20 × 5 = 678,000", () => {
  const c = R.calculateMonth("2026-10", tables, "2026-10-26");
  assert.equal(c.count, 2);
  assert.deepEqual(c.segments.map((s) => [s.tableDate, s.unl95]), [["2026-10-20", 2_739_000], ["2026-10-23", 2_686_000]]);
  assert.equal(c.avgQuote20L, 2_712_500);
  assert.equal(c.avgPerLitre, 135_625);
  assert.equal(c.rawPerDay, 678_125);
  assert.equal(c.ratePerDay, 678_000);
  assert.equal(R.payslipLine(c.ratePerDay, 26).total, 17_628_000);
});

test("a third table (20, 23, 26 style) is simply added and divided by three", () => {
  const t = [{ date: "2026-10-20", unl95: 2_000_000 }, { date: "2026-10-23", unl95: 2_300_000 }, { date: "2026-10-26", unl95: 2_600_000 }];
  const c = R.calculateMonth("2026-10", t, "2026-10-27");
  assert.equal(c.count, 3);
  assert.equal(c.avgQuote20L, 2_300_000); // (2.0 + 2.3 + 2.6) ÷ 3
  assert.equal(c.ratePerDay, 575_000);    // 2,300,000 ÷ 20 × 5
});

test("a table that stays in force for many days still counts once", () => {
  const t = [{ date: "2026-10-01", unl95: 2_800_000 }, { date: "2026-10-30", unl95: 3_000_000 }];
  const c = R.calculateMonth("2026-10", t, "2026-11-05");
  assert.equal(c.status, "complete");
  assert.equal(c.count, 2);
  assert.equal(c.avgQuote20L, 2_900_000); // not day-weighted
});

test("no new table in the month → the old price stands (counted again)", () => {
  const t = [{ date: "2026-10-29", unl95: 2_844_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-11-30");
  assert.equal(c.count, 1);
  assert.equal(c.segments[0].tableDate, "2026-10-29");
  assert.equal(c.avgQuote20L, 2_844_000);
});

test("price in force before the month starts is the first entry", () => {
  const t = [{ date: "2026-10-29", unl95: 2_844_000 }, { date: "2026-11-02", unl95: 2_837_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-11-03");
  assert.deepEqual(c.segments.map((s) => s.tableDate), ["2026-10-29", "2026-11-02"]);
  assert.equal(c.avgQuote20L, 2_840_500);
});

test("a full month after the start date is entirely fuel-indexed (no mixing)", () => {
  const t = [{ date: "2026-10-22", unl95: 2_800_000 }];
  const c = R.calculateMonth("2026-11", t, "2026-12-05");
  assert.equal(c.mixed, false);
  assert.equal(c.ratePerDay, 700_000);
});

test("floor of 500,000 and cap of 800,000 apply", () => {
  const low = R.rateFromAverageQuote(1_400_000);   // 350,000 raw
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
  const c = R.calculateMonth("2026-12", tables.filter((x) => x.date <= "2026-10-22"), "2026-10-22");
  assert.equal(c.status, "future");
  assert.equal(c.count, 1);
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

test("October calculator: whole month = 1 Oct at 450K + 8 tables → 690,000 × 26 days", () => {
  const c = R.calculatePeriod(undefined, tables, "2026-10-30");
  assert.equal(c.from, "2026-10-02");
  assert.equal(c.count, 8);
  assert.equal(c.avgQuote20L, 2_758_500);
  assert.equal(c.ratePerDay, 690_000);
  assert.deepEqual(c.rows.map((r) => [r.key, r.from, r.to, r.days, r.ratePerDay, r.total]), [
    ["old", "2026-10-01", "2026-10-01", 1, 450_000, 450_000],     // 1 Oct counts at 450K
    ["new", "2026-10-02", "2026-10-31", 25, 690_000, 17_250_000]]);
  assert.equal(c.totalDays, 26);                      // Mon–Sat = 27, a pay month is 26
  assert.equal(c.total, 17_700_000);
});

test("October calculator: from 9 Oct → 450K before, fuel rate after, full average", () => {
  const c = R.calculatePeriod("2026-10-09", tables, "2026-10-30");
  assert.equal(c.count, 6);                          // 9, 13, 16, 20, 23, 30 Oct
  assert.equal(c.ratePerDay, 684_000);               // 2,734,333 ÷ 20 × 5 = 683,583
  assert.deepEqual(c.rows.map((r) => [r.from, r.to, r.days, r.ratePerDay, r.total]), [
    ["2026-10-01", "2026-10-08", 7, 450_000, 3_150_000],
    ["2026-10-09", "2026-10-31", 19, 684_000, 12_996_000]]);
  assert.equal(c.total, 16_146_000);                 // 7 × 450,000 + 19 × 684,000
  assert.equal(c.avgPerDay, 621_000);
  assert.deepEqual(c.chips.map((x) => x.date.slice(8)), ["02", "06", "09", "13", "16", "20", "23", "27", "30"]);
  assert.equal(c.chips.find((x) => x.date === "2026-10-27").published, false); // button even without a table
  assert.equal(R.calculatePeriod("2026-10-27", tables, "2026-10-30").count, 2); // 23 Oct price in force + 30 Oct
});

test("October calculator: dates are clamped, limits apply, weekends are not working days", () => {
  assert.equal(R.calculatePeriod("2026-09-01", tables, "2026-10-30").from, "2026-10-02");
  assert.equal(R.calculatePeriod("2026-12-01", tables, "2026-10-30").from, "2026-10-30");
  assert.throws(() => R.calculatePeriod("nope", tables, "2026-10-30"), RangeError);
  assert.equal(R.workingDays("2026-10-01", "2026-10-31"), 27); // before the 26-day cap
  assert.equal(R.workingDays("2026-10-04", "2026-10-04"), 0); // a Sunday
  assert.equal(R.workingDays("2026-10-03", "2026-10-03"), 1); // a Saturday counts
  const low = R.calculatePeriod(undefined, [{ date: "2026-10-02", unl95: 1_400_000 }], "2026-10-30");
  assert.equal(low.ratePerDay, 500_000);
  assert.equal(low.clamped, "min");
});
