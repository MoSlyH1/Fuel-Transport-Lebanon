/* =====================================================================
   service.js — ties it together: keep prices fresh, build the answers
   ===================================================================== */
"use strict";

const history = require("./history");
const { fetchIpt, SOURCE_NAME, SOURCE_URLS } = require("./ipt");
const {
  RULE, addMonths, calculateMonth, payslipLine, todayBeirut,
} = require("./rules");

const MAX_AGE_MS = 30 * 60 * 1000;       // normal page loads re-read IPT at most every 30 min
const FORCE_MIN_MS = 60 * 1000;          // the "Update from IPT" button: at most once a minute
const FAIL_BACKOFF_MS = 5 * 60 * 1000;   // don't hammer IPT while it is down
const FORCE_FAIL_BACKOFF_MS = 15 * 1000;
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

const FUELS = [
  { key: "unl95", name: "UNL 95", unit: "per 20 L", litres: 20 },
  { key: "unl98", name: "UNL 98", unit: "per 20 L", litres: 20 },
  { key: "diesel", name: "Diesel", unit: "per 20 L", litres: 20 },
  { key: "lpg", name: "Gas (LPG)", unit: "per 10 kg cylinder", litres: null },
];

let inflight = null;
let failAt = 0;
let lastError = null;

/**
 * Reads IPT if the stored prices are older than the allowed age.
 * Never throws.
 * @returns {Promise<{status: "updated"|"unchanged"|"throttled"|"failed", tableDate?: string, error?: string}>}
 */
async function refresh({ force = false } = {}) {
  await history.load();
  const now = Date.now();
  if (now - history.getCheckedAt() < (force ? FORCE_MIN_MS : MAX_AGE_MS)) return { status: "throttled" };
  if (now - failAt < (force ? FORCE_FAIL_BACKOFF_MS : FAIL_BACKOFF_MS)) return { status: "failed", error: lastError };
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const parsed = await fetchIpt();
      const today = todayBeirut();
      let date = parsed.date;
      if (!date) { // table without a readable date → "in force today", unless it matches the latest table
        const latest = history.all().filter((t) => t.date <= today).pop();
        date = latest && latest.unl95 === parsed.prices.unl95 ? latest.date : today;
      }
      if (date > today) date = today; // never record into the future
      const { write, changed } = history.record(date, parsed.prices, `${SOURCE_NAME} (live)`);
      if (write) await history.persist(date);
      await history.markChecked(date);
      failAt = 0; lastError = null;
      return { status: changed ? "updated" : "unchanged", tableDate: date };
    } catch (e) {
      failAt = Date.now();
      lastError = e && e.message ? e.message : "IPT unreachable";
      console.warn("[fuel] IPT read failed:", lastError);
      return { status: "failed", error: lastError };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The four products, each with its previous price for the ▲▼ change. */
function pricesSnapshot(today) {
  const tables = history.all().filter((t) => t.date <= today);
  const newest = tables[tables.length - 1];
  const checkedAt = history.getCheckedAt();
  const fuels = FUELS.map((f) => {
    const withValue = tables.filter((t) => t[f.key] != null);
    const last = withValue[withValue.length - 1];
    const prev = withValue[withValue.length - 2];
    return {
      key: f.key, name: f.name, unit: f.unit,
      price: last ? last[f.key] : null,
      perLitre: last && f.litres ? last[f.key] / f.litres : null,
      asOf: last ? last.date : null,
      change: last && prev ? last[f.key] - prev[f.key] : null,
    };
  });
  return {
    tableDate: newest ? newest.date : null,
    checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
    live: checkedAt > 0 && Date.now() - checkedAt < LIVE_WINDOW_MS,
    source: SOURCE_NAME,
    sourceUrl: SOURCE_URLS[0],
    fuels,
  };
}

/** Month rows for the table / picker: first month on the new terms → 3 months ahead. */
function monthList(tables, today) {
  const current = today.slice(0, 7);
  const first = RULE.newRuleStart;
  const last = addMonths(current < first ? first : current, 3);
  const rows = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    const c = calculateMonth(m, tables, today);
    rows.push({
      month: c.month, label: c.label, status: c.status,
      days: c.days, averagedFrom: c.averagedFrom, averagedTo: c.averagedTo,
      avgQuote20L: c.avgQuote20L, ratePerDay: c.ratePerDay, clamped: c.clamped,
    });
  }
  return rows;
}

function ruleInfo() {
  return {
    fuel: RULE.fuel, litresPerDay: RULE.litresPerDay, litresPerQuote: RULE.litresPerQuote,
    minPerDay: RULE.minPerDay, maxPerDay: RULE.maxPerDay, roundTo: RULE.roundTo,
    legacyPerDay: RULE.legacyPerDay, newRuleStart: RULE.newRuleStart, defaultDays: RULE.defaultDays,
  };
}

/** One call = everything the page needs. */
async function summary({ month, days, employees } = {}) {
  await refresh({ force: false });
  const today = todayBeirut();
  const tables = history.all();
  const current = today.slice(0, 7);
  const chosen = month || (current < RULE.newRuleStart ? RULE.newRuleStart : current);
  const rate = calculateMonth(chosen, tables, today);
  return {
    today,
    generatedAt: new Date().toISOString(),
    rule: ruleInfo(),
    prices: pricesSnapshot(today),
    rate,
    payslip: payslipLine(rate.ratePerDay, days ?? RULE.defaultDays, employees ?? 1),
    months: monthList(tables, today),
  };
}

async function prices() {
  await refresh({ force: false });
  return pricesSnapshot(todayBeirut());
}

async function rate({ month, days, employees } = {}) {
  await refresh({ force: false });
  const today = todayBeirut();
  const current = today.slice(0, 7);
  const r = calculateMonth(month || (current < RULE.newRuleStart ? RULE.newRuleStart : current), history.all(), today);
  return { ...r, rule: ruleInfo(), payslip: payslipLine(r.ratePerDay, days ?? RULE.defaultDays, employees ?? 1) };
}

/** The "Update from IPT" button and the daily cron. */
async function forceRefresh() {
  const result = await refresh({ force: true });
  const p = pricesSnapshot(todayBeirut());
  return { ...result, tableDate: p.tableDate, checkedAt: p.checkedAt, live: p.live };
}

module.exports = { summary, prices, rate, forceRefresh, refresh, FUELS };
