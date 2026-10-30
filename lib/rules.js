/* =====================================================================
   rules.js — the transportation rule + date helpers (pure, no I/O)
   =====================================================================
   OLD TERMS   fixed 450,000 L.L. per day                (before Oct 2026)
   NEW TERMS   from October 2026, the daily rate is what 5 litres of
               UNL 95 cost on AVERAGE over the pay month, using the
               official IPT price tables:

     average price / 20 L = (sum of the price tables) ÷ (number of tables)
     price of 1 litre     = average ÷ 20
     daily rate           = 5 × price of 1 litre, rounded to 1,000 L.L.,
                            then kept between 500,000 and 800,000 L.L.
     transportation       = days worked × daily rate

   Every new official price table counts ONCE, whatever the number of days
   it stayed in force (e.g. 2,739,000 + 2,686,000 → ÷ 2 = 2,712,500).
   The table already in force on the first day of the period is the first
   entry; if no new table comes out, that old price simply stands again.
   The current month is averaged up to today; a future month uses the
   latest table.
   ===================================================================== */
"use strict";

const RULE = Object.freeze({
  fuel: "UNL 95",
  litresPerDay: 5,
  litresPerQuote: 20, // petrol is quoted per 20 L
  minPerDay: 500_000,
  maxPerDay: 800_000,
  roundTo: 1_000,
  legacyPerDay: 450_000, // old terms
  newRuleStart: "2026-10-22", // first month on the new terms
   newRuleMonth: "2026-10", // month that contains it
  defaultDays: 26, // "26 = full month"
  periodFirst: "2026-10-02", // first official price table of October 2026 → earliest start for the fuel rate
  periodChips: ["2026-10-02", "2026-10-06", "2026-10-09", "2026-10-13", "2026-10-16", "2026-10-20", "2026-10-23", "2026-10-27", "2026-10-30"], // start-date buttons
  periodChips: ["2026-10-02", "2026-10-06", "2026-10-09", "2026-10-13", "2026-10-16", "2026-10-20", "2026-10-23", "2026-10-27", "2026-10-30"], // start-date buttons
  periodMonthStart: "2026-10-01", // the October period begins here; days before the chosen start stay at 450,000
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
 * Simple average of the UNL 95 quote over [from, to]:
 *   - the table in force on `from` (the old price carried in), plus
 *   - every table published after `from`, up to `to`.
 * Each table counts once, whatever the number of days it stayed in force.
 * @param {Array<{date:string, unl95:number}>} tables  oldest first
 */
function averageQuote(tables, from, to) {
  if (!tables.length || from > to) return null;
  let i = -1; // index of the table in force on `from`
  while (i + 1 < tables.length && tables[i + 1].date <= from) i++;

  const used = [tables[Math.max(i, 0)]]; // before the first table → hold the first
  for (let k = i + 1; k < tables.length && tables[k].date <= to; k++) used.push(tables[k]);

  const segments = used.map((t) => ({ tableDate: t.date, unl95: t.unl95 }));
  const sum = segments.reduce((a, t) => a + t.unl95, 0);
  const count = segments.length;
  return { sum, count, avgQuote: sum / count, segments };
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
      averagedFrom: null, averagedTo: null, count: 0, segments: [] };
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
  // days from the 22nd use the fuel rate ("500K–800K" button). No blending —
  // the page lets you pick which one applies. ratePerDay = the fuel rate.
  const oldDays = feeStart > start ? daysBetween(start, feeStart) : 0;
  const newDays = base.daysInMonth - oldDays;
  const mixed = oldDays > 0; // "split month" (October 2026)
  const ratePerDay = r.ratePerDay;
  return {
    ...base, status, legacy: false, mixed,
    averagedFrom: from, averagedTo: to, count: avg.count,
    segments: avg.segments,
    sumQuotes: avg.sum,
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

/**
 * The October calculator: "the new terms start on `from`".
 *   - days before `from` (from 1 Oct) stay at the old fixed 450,000
 *   - days from `from` to the end of the month use the fuel rate, averaged from
 *     `from` until today (or the end of the month once it has passed)
 *   - the average per day over the whole period is total ÷ days
 * Days are Mon–Sat (Sundays excluded); a pay month is capped at 26 days (the extra day comes off the
 * last period). The page lets the user change them.
 * @param {string|undefined} from  ISO date; default = whole month (2 Oct)
 * @param {{newOnly?: boolean}} opts  newOnly = every day of the month at the new average (no 450K days)
 */
function calculatePeriod(from, tables, today, { newOnly = false } = {}) {
  const first = RULE.periodFirst;
  const month = first.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const end = lastOfMonth(y, m);
  const last = today < end ? today : end; // the average runs "until today"
  if (last < first) throw new RangeError("The new prices start on " + first);
  if (from != null && !isIsoDate(from)) throw new RangeError("Invalid date");

  let start = newOnly ? first : from || first;
  if (start < first) start = first;
  if (start > last) start = last;

  const avg = averageQuote(tables, start, last);
  if (!avg) throw new Error("No fuel price history available");
  const r = rateFromAverageQuote(avg.avgQuote);

  const monthStart = RULE.periodMonthStart;
  const oldTo = addDays(start, -1);
  const rows = [];
  if (newOnly) { /* whole month on the new average only: no 450K days */ }
  else if (start > monthStart) rows.push({ key: "old", from: monthStart, to: oldTo, days: workingDays(monthStart, oldTo), ratePerDay: RULE.legacyPerDay });
  const newFrom = newOnly ? monthStart : start;
  rows.push({ key: "new", from: newFrom, to: end, days: workingDays(newFrom, end), ratePerDay: r.ratePerDay });
  // A pay month is 26 days: Sundays are excluded (Mon–Sat = 27 in Oct 2026), and the extra day
  // comes off the last period. Days stay editable on the page.
  let extra = rows.reduce((a, x) => a + x.days, 0) - RULE.defaultDays;
  for (let i = rows.length - 1; i >= 0 && extra > 0; i--) { const cut = Math.min(extra, rows[i].days); rows[i].days -= cut; extra -= cut; }
  for (const row of rows) row.total = row.days * row.ratePerDay;
  const totalDays = rows.reduce((a, x) => a + x.days, 0);
  const total = rows.reduce((a, x) => a + x.total, 0);

  return {
    month, label: monthLabel(month), first, monthStart, end, from: start, to: last, mode: newOnly ? "new" : "split",
    status: today >= end ? "complete" : "partial",
    oldRatePerDay: RULE.legacyPerDay,
    tableDates: tables.filter((t) => t.date >= first && t.date <= last).map((t) => t.date),
    // buttons: the usual IPT dates (even if no table came out that day, or not yet) + any other table
    chips: [...new Set([...RULE.periodChips, ...tables.filter((t) => t.date >= first && t.date <= end).map((t) => t.date)])].sort()
      .map((date) => ({ date, published: tables.some((t) => t.date === date), future: date > today })),
    count: avg.count, segments: avg.segments, sumQuotes: avg.sum,
    avgQuote20L: avg.avgQuote, avgPerLitre: r.perLitre, rawPerDay: r.raw, roundedPerDay: r.rounded,
    ratePerDay: r.ratePerDay, clamped: r.clamped,
    rows, totalDays, total,
    avgPerDay: totalDays ? Math.round(total / totalDays) : null,
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
  averageQuote, rateFromAverageQuote, calculateMonth, calculatePeriod, workingDays, payslipLine,
};