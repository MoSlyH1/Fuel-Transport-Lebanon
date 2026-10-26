/* =====================================================================
   rules.js — the transportation rule + date helpers (pure, no I/O)
   =====================================================================
   OLD TERMS   fixed 450,000 L.L. per day                (before Oct 2026)
   NEW TERMS   from October 2026, the daily rate is what 5 litres of
               UNL 95 cost on AVERAGE over the pay month, using the
               official IPT price tables:

     average price / 20 L = Σ (table price × days in force) ÷ days
     price of 1 litre     = average ÷ 20
     daily rate           = 5 × price of 1 litre, rounded to 1,000 L.L.,
                            then kept between 500,000 and 800,000 L.L.
     transportation       = days worked × daily rate

   Days that have no published price yet are not averaged: the current
   month is averaged up to today; a future month uses the latest table.
   ===================================================================== */
"use strict";

const RULE = Object.freeze({
  fuel: "UNL 95",
  litresPerDay: 5,
  litresPerQuote: 20, // petrol is quoted per 20 L
  minPerDay: 400_000,
  maxPerDay: 800_000,
  roundTo: 1_000,
  legacyPerDay: 450_000, // old terms
  newRuleStart: "2026-10-22", // first month on the new terms
   newRuleMonth: "2026-10", // month that contains it
  defaultDays: 26, // "26 = full month"
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

/** Today in Beirut (ISO). FUEL_TODAY overrides it — used by the tests only. */
function todayBeirut() {
  const o = process.env.FUEL_TODAY;
  if (o && isIsoDate(o)) return o;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

/* ---------------- the rule ---------------- */

/**
 * Time-weighted average of the UNL 95 quote over [from, to].
 * @param {Array<{date:string, unl95:number}>} tables  oldest first
 */
function averageQuote(tables, from, to) {
  if (!tables.length || from > to) return null;
  let i = -1; // index of the table in force on `from`
  while (i + 1 < tables.length && tables[i + 1].date <= from) i++;

  const segments = [];
  let sum = 0, days = 0, cursor = from;
  while (cursor <= to) {
    const cur = tables[Math.max(i, 0)]; // before the first table → hold the first
    const next = tables[i + 1];
    const segEnd = next && addDays(next.date, -1) < to ? addDays(next.date, -1) : to;
    const n = daysBetween(cursor, segEnd) + 1;
    sum += cur.unl95 * n;
    days += n;
    const last = segments[segments.length - 1];
    if (last && last.tableDate === cur.date) { last.to = segEnd; last.days += n; }
    else segments.push({ from: cursor, to: segEnd, days: n, unl95: cur.unl95, tableDate: cur.date });
    cursor = addDays(segEnd, 1);
    i++;
  }
  return { sum, days, avgQuote: sum / days, segments };
}

/** avg price per 20 L → daily rate (round to 1,000, then floor/cap). */
function rateFromAverageQuote(avgQuote) {
  const perLitre = avgQuote / RULE.litresPerQuote;
  const raw = RULE.litresPerDay * perLitre;
  const rounded = Math.round(raw / RULE.roundTo) * RULE.roundTo;
  const ratePerDay = Math.min(RULE.maxPerDay, Math.max(RULE.minPerDay, rounded));
  const clamped = rounded < RULE.minPerDay ? "min" : rounded > RULE.maxPerDay ? "max" : null;
  return { perLitre, raw, rounded, ratePerDay, clamped };
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
      averagedFrom: null, averagedTo: null, days: 0, segments: [] };
  }

  // Only days from 22 Oct 2026 are averaged.
  const feeStart = start > RULE.newRuleStart ? start : RULE.newRuleStart;
  let from = feeStart, to = end, status = "complete";
  if (feeStart > today) { from = to = today; status = "future"; }
  else if (end > today) { to = today; status = "partial"; }

  const avg = averageQuote(tables, from, to);
  if (!avg) throw new Error("No fuel price history available");
  const r = rateFromAverageQuote(avg.avgQuote);

  // October: days before the 22nd stay on the fixed 450,000 ("450K" button),
  // days from the 22nd use the fuel rate ("400K–800K" button). No blending —
  // the page lets you pick which one applies. ratePerDay = the fuel rate.
  const oldDays = feeStart > start ? daysBetween(start, feeStart) : 0;
  const newDays = base.daysInMonth - oldDays;
  const mixed = oldDays > 0; // "split month" (October 2026)
  const ratePerDay = r.ratePerDay;
  return {
    ...base, status, legacy: false, mixed,
    averagedFrom: from, averagedTo: to, days: avg.days,
    segments: avg.segments,
    sumQuoteDays: avg.sum,
    avgQuote20L: avg.avgQuote,
    avgPerLitre: r.perLitre,
    rawPerDay: r.raw,
    roundedPerDay: r.rounded,
    fuelRatePerDay: r.ratePerDay,
    oldDays, newDays,
    ratePerDay,
    clamped: r.clamped,
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
  averageQuote, rateFromAverageQuote, calculateMonth, payslipLine,
};
