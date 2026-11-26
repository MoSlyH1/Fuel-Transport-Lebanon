/* =====================================================================
   rules.js — the transportation rule + date helpers (pure, no I/O)
   =====================================================================
   OLD TERMS   fixed 450,000 L.L. per day                (before 22 Oct 2026)
   NEW TERMS   from 22 October 2026, the daily rate is what 5 litres of
               UNL 95 cost on AVERAGE over the pay month, using the
               official IPT price tables (government method):

     every calendar day of the month gets the price IN FORCE that day
     (Saturdays and Sundays included — a month is a whole month):
       a new table counts from the day it is published, and its price is
       carried over every following day until the next table comes out.
       The price in force on the 1st (published the previous month) covers
       the days until the month's first new table.

     average price / 20 L = (sum of the daily prices) ÷ (days in the month)
     price of 1 litre     = average ÷ 20
     daily rate           = 5 × litre price, ROUNDED TO THE NEAREST 1,000
                            (every month), then kept between
                            500,000 and 800,000 L.L.
     transportation       = days worked × daily rate

   Example, October 2026 (31 days): 2,844,000 × 1 + 2,837,000 × 4 + …
   + 2,611,000 × 2 = 85,488,000 ÷ 31 = 2,757,677 / 20 L → 689,419 → 689,000.
   The government published 690,000 for October 2026, so that is the FINAL
   daily rate for October (see RULE.officialRates); the calculation lines
   still show the exact figures (2,757,677.419 → 689,419.35 → 689,000).

   The current month is averaged over the days up to today. Future months
   are not predicted.
   ===================================================================== */
"use strict";

const RULE = Object.freeze({
  fuel: "UNL 95",
  litresPerDay: 5,
  litresPerQuote: 20, // petrol is quoted per 20 L
  minPerDay: 500_000,
  maxPerDay: 800_000,
  roundTo: 1_000, // the daily amount (5 litres) is rounded to the nearest 1,000 L.L. — every month
  legacyPerDay: 450_000, // old terms
  newRuleStart: "2026-10-22", // first day on the new terms
  newRuleMonth: "2026-10", // month that contains it
  defaultDays: 26, // "26 = full month" (payroll days, editable on the page)
  // Final daily rate published by the government for a whole month. It replaces the calculated
  // rate once that whole month is averaged (1st → last day). Add a line here if another month differs.
  officialRates: Object.freeze({ "2026-10": 690_000 }),
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/* ---------------- dates (ISO strings, UTC arithmetic) ---------------- */
const isIsoDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100;
};
const isMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && isIsoDate(`${s}-01`);

const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86_400_000);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86_400_000); // b − a
const lastOfMonth = (y, m) => fromUTC(Date.UTC(y, m, 0)); // m is 1-based
const monthLabel = (month) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const addMonths = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Mon–Sat days between two ISO dates, both included (only Sunday is excluded). 0 if a > b. */
function workingDays(a, b) {
  if (a > b) return 0;
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (new Date(toUTC(d)).getUTCDay() !== 0) n++;
  return n;
}

/** Today in Beirut (ISO). FUEL_TODAY overrides it — used by the tests only. */
function todayBeirut() {
  const o = process.env.FUEL_TODAY;
  if (o && isIsoDate(o)) return o;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

/* ---------------- the rule ---------------- */

/**
 * Day-by-day average of the UNL 95 price over [from, to] (both included, every calendar day):
 * each day takes the table in force that day; a table stays in force until the next one.
 * Before the very first known table, the first table is held.
 * @param {Array<{date:string, unl95:number}>} tables  oldest first
 * @returns {{sum:number, days:number, count:number, avgQuote:number,
 *            segments:Array<{tableDate:string, unl95:number, from:string, to:string, days:number}>}|null}
 *   sum = Σ daily prices, days = calendar days averaged, count = number of tables used
 */
function averageQuote(tables, from, to) {
  const list = tables.filter((t) => t && t.unl95 != null);
  if (!list.length || from > to) return null;

  let i = -1; // index of the table in force on `from`
  while (i + 1 < list.length && list[i + 1].date <= from) i++;
  if (i < 0) i = 0;

  const segments = [];
  for (let d = from; d <= to;) {
    while (i + 1 < list.length && list[i + 1].date <= d) i++;
    const t = list[i];
    const next = i + 1 < list.length ? list[i + 1].date : null;
    const segTo = next && next <= to ? addDays(next, -1) : to; // carried until the day before the next table
    const days = daysBetween(d, segTo) + 1;
    segments.push({ tableDate: t.date, unl95: t.unl95, from: d, to: segTo, days });
    d = addDays(segTo, 1);
  }
  const sum = segments.reduce((a, s) => a + s.unl95 * s.days, 0);
  const days = segments.reduce((a, s) => a + s.days, 0);
  return { sum, days, count: segments.length, avgQuote: sum / days, segments };
}

/** Rounding step of a pay month: the nearest 1,000 in every month. */
const roundToFor = () => RULE.roundTo;

/** The government's published rate for `month`, if the average covers that whole month. */
function officialRate(month, from, to) {
  const v = RULE.officialRates[month];
  if (v == null) return null;
  const [y, m] = month.split("-").map(Number);
  return from === `${month}-01` && to === lastOfMonth(y, m) ? v : null;
}

/** Replaces the final rate by the government's published one (the calculated lines stay exact). */
function withOfficial(r, official) {
  if (official == null) return { ...r, official: null };
  return { ...r, calculatedRate: r.ratePerDay, ratePerDay: official, clamped: null, official };
}

/** avg price per 20 L → price of 1 litre → × 5 → rounded to the nearest 1,000 → floor/cap. */
function rateFromAverageQuote(avgQuote, roundTo = RULE.roundTo) {
  const perLitre = avgQuote / RULE.litresPerQuote;
  const raw = RULE.litresPerDay * perLitre;                          // 5 × 137,884 = 689,419
  const rounded = Math.round(raw / roundTo) * roundTo;               // → 689,000
  const ratePerDay = Math.min(RULE.maxPerDay, Math.max(RULE.minPerDay, rounded));
  const clamped = rounded < RULE.minPerDay ? "min" : rounded > RULE.maxPerDay ? "max" : null;
  return { perLitre, raw, rounded, ratePerDay, clamped, roundTo };
}

/**
 * Everything the page shows for one pay month.
 * @param {string} month   "YYYY-MM"
 * @param {Array}  tables  every known price table, oldest first
 * @param {string} today   ISO date (Beirut)
 */
function calculateMonth(month, tables, today) {
  if (!isMonth(month)) throw new RangeError("Invalid month");
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = lastOfMonth(y, m);
  const base = {
    month, label: monthLabel(month), start, end,
    daysInMonth: Number(end.slice(8)),
    oldRatePerDay: RULE.legacyPerDay,
  };

  if (end < RULE.newRuleStart) {
    return { ...base, status: "legacy", legacy: true, mixed: false, ratePerDay: RULE.legacyPerDay, clamped: null,
      oldDays: base.daysInMonth, newDays: 0, fuelRatePerDay: null,
      averagedFrom: null, averagedTo: null, count: 0, avgDays: 0, segments: [] };
  }

  // The average always covers the whole calendar month (1st → last day, weekends included),
  // up to today while the month is still running. October 2026 too: only the PAY is split at the 22nd.
  let from = start, to = end, status = "complete";
  if (start > today) { from = to = today; status = "future"; }
  else if (end > today) { to = today; status = "partial"; }

  const avg = averageQuote(tables, from, to);
  if (!avg) throw new Error("No fuel price history available");
  const r = withOfficial(rateFromAverageQuote(avg.avgQuote, roundToFor(month)), officialRate(month, from, to));

  // October: days before the 22nd stay on the fixed 450,000 ("450K" button),
  // days from the 22nd use the fuel rate ("500K–800K" button). ratePerDay = the fuel rate.
  const feeStart = start > RULE.newRuleStart ? start : RULE.newRuleStart;
  const oldDays = feeStart > start ? daysBetween(start, feeStart) : 0;
  const newDays = base.daysInMonth - oldDays;
  const mixed = oldDays > 0; // "split month" (October 2026)
  return {
    ...base, status, legacy: false, mixed,
    averagedFrom: from, averagedTo: to, count: avg.count, avgDays: avg.days,
    segments: avg.segments,
    sumQuotes: avg.sum,
    avgQuote20L: avg.avgQuote,
    avgPerLitre: r.perLitre,
    rawPerDay: r.raw,
    roundedPerDay: r.rounded,
    roundTo: r.roundTo,
    fuelRatePerDay: r.ratePerDay,
    calculatedRatePerDay: r.calculatedRate ?? r.ratePerDay,
    official: r.official,
    oldDays, newDays,
    ratePerDay: r.ratePerDay,
    clamped: r.clamped,
  };
}

/** IPT publishes on Tuesdays and Fridays — the usual start-date buttons of a month (first … end). */
function usualTableDates(first, end) {
  const out = [];
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const dow = new Date(toUTC(d)).getUTCDay();
    if (dow === 2 || dow === 5) out.push(d);
  }
  return out;
}

/**
 * The monthly calculator (October 2026 onwards): "the new terms start on `from`".
 *   - days before `from` (from the 1st) stay at the PREVIOUS rate: the old fixed 450,000 in
 *     October 2026, the previous month's fuel rate in any later month
 *   - days from `from` to the end of the month use the fuel rate: the day-by-day average from
 *     `from` until today (or the end of the month once it has passed)
 * Payroll days are Mon–Sat and a full pay month is 26 days (the last period absorbs the
 * difference); the page lets the user change them. The AVERAGE always counts every calendar day.
 * @param {string|undefined} from  ISO date; default = whole month
 * @param {{newOnly?: boolean, month?: string}} opts
 *   newOnly = every day of the month at the new average (no previous-rate days)
 *   month   = "YYYY-MM"; default = the current month (never before October 2026)
 */
function calculatePeriod(from, tables, today, { newOnly = false, month } = {}) {
  const current = today.slice(0, 7);
  if (month == null) month = current < RULE.newRuleMonth ? RULE.newRuleMonth : current;
  if (!isMonth(month)) throw new RangeError("Invalid month");
  if (month < RULE.newRuleMonth) throw new RangeError("The new terms start in " + monthLabel(RULE.newRuleMonth));
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const end = lastOfMonth(y, m);
  const last = today < end ? today : end; // the average runs "until today"
  if (last < first) throw new RangeError("No prices for " + monthLabel(month) + " yet");
  if (from != null && !isIsoDate(from)) throw new RangeError("Invalid date");

  let start = newOnly ? first : from || first;
  if (start < first) start = first;
  if (start > last) start = last;

  // October 2026 only: starting on the 22nd (the date the new terms began) = the average of the
  // WHOLE month, exactly as if the new average applied to the whole month.
  const avgFrom = month === RULE.newRuleMonth && start === RULE.newRuleStart ? first : start;
  const avg = averageQuote(tables, avgFrom, last);
  if (!avg) throw new Error("No fuel price history available");
  const roundTo = roundToFor(month);
  const r = withOfficial(rateFromAverageQuote(avg.avgQuote, roundTo), officialRate(month, avgFrom, last));

  // the rate that applies before the new average: 450,000 in October 2026, else last month's fuel rate
  const prevRate = month === RULE.newRuleMonth
    ? RULE.legacyPerDay
    : calculateMonth(addMonths(month, -1), tables, today).fuelRatePerDay ?? RULE.legacyPerDay;

  const oldTo = addDays(start, -1);
  const rows = [];
  if (!newOnly && start > first) rows.push({ key: "old", from: first, to: oldTo, days: workingDays(first, oldTo), ratePerDay: prevRate });
  const newFrom = newOnly ? first : start;
  rows.push({ key: "new", from: newFrom, to: end, days: workingDays(newFrom, end), ratePerDay: r.ratePerDay });
  // A full pay month is 26 days, whatever the number of Mon–Sat days: the last period takes the difference.
  let diff = RULE.defaultDays - rows.reduce((a, x) => a + x.days, 0);
  if (diff > 0) rows[rows.length - 1].days += diff;
  for (let i = rows.length - 1; i >= 0 && diff < 0; i--) { const cut = Math.min(-diff, rows[i].days); rows[i].days -= cut; diff += cut; }
  for (const row of rows) row.total = row.days * row.ratePerDay;
  const totalDays = rows.reduce((a, x) => a + x.days, 0);
  const total = rows.reduce((a, x) => a + x.total, 0);

  return {
    month, label: monthLabel(month), first, monthStart: first, end, from: start, to: last, avgFrom, mode: newOnly ? "new" : "split",
    status: today >= end ? "complete" : "partial",
    oldRatePerDay: prevRate,
    tableDates: tables.filter((t) => t.date >= first && t.date <= last).map((t) => t.date),
    // buttons: the usual IPT dates (even if no table came out that day, or not yet) + any other table
    chips: [...new Set([...usualTableDates(first, end), ...tables.filter((t) => t.date >= first && t.date <= end).map((t) => t.date)])].sort()
      .map((date) => ({ date, published: tables.some((t) => t.date === date), future: date > today })),
    count: avg.count, avgDays: avg.days, segments: avg.segments, sumQuotes: avg.sum,
    avgQuote20L: avg.avgQuote, avgPerLitre: r.perLitre, rawPerDay: r.raw, roundedPerDay: r.rounded, roundTo,
    ratePerDay: r.ratePerDay, clamped: r.clamped,
    calculatedRatePerDay: r.calculatedRate ?? r.ratePerDay, official: r.official,
    rows, totalDays, total,
    avgPerDay: totalDays ? Math.round(total / totalDays / roundTo) * roundTo : null, // nearest 1,000
  };
}

/** days × rate (× employees), plus the difference against the old terms. */
function payslipLine(ratePerDay, days, employees = 1) {
  const perEmployee = days * ratePerDay;
  const oldPerEmployee = days * RULE.legacyPerDay;
  return {
    days, employees, ratePerDay,
    perEmployee,
    total: perEmployee * employees,
    oldTotal: oldPerEmployee * employees,
    differenceVsOld: (perEmployee - oldPerEmployee) * employees,
  };
}

module.exports = {
  RULE, MONTHS,
  isIsoDate, isMonth, addDays, daysBetween, lastOfMonth, monthLabel, addMonths, todayBeirut,
  averageQuote, roundToFor, rateFromAverageQuote, calculateMonth, calculatePeriod, workingDays, payslipLine,
};