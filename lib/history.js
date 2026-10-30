/* =====================================================================
   history.js — every official IPT price table, by the date it took effect
   =====================================================================
   The rate is an AVERAGE over the month, so we need the price in force
   on every day — not just today's. Lebanon's Ministry of Energy publishes
   a new table about twice a week; IPT shows the latest one on
   https://www.iptgroup.com.lb/ipt/en/our-stations/fuel-prices

     1. SEED — tables from Jun 29 → Oct 30, 2026 (from the project you
        sent). "derived" rows were worked back from the next table's
        published change.
     2. LIVE — every table read from IPT is stored under its own date, in
        memory and in PostgreSQL, so the history keeps growing by itself.
        A live reading always wins over a seed row for the same date.

   Petrol/diesel: L.L. per 20 litres. LPG: L.L. per cylinder.
   ===================================================================== */
"use strict";

const db = require("./db");

// date (in force from), UNL 95, UNL 98, diesel, LPG, source
const SEED = [
  ["2026-06-29", 2_238_000, 2_256_000, null, null, "saidaonline.com/318592"],
  ["2026-07-07", 2_207_000, 2_225_000, null, null, "derived from 2026-07-10 (+14,000)"],
  ["2026-07-10", 2_221_000, 2_239_000, null, null, "saidaonline.com/318907"],
  ["2026-07-24", 2_414_000, 2_432_000, null, null, "derived from 2026-07-28 (−12,000)"],
  ["2026-07-28", 2_402_000, 2_420_000, null, null, "lebanon.shafaqna.com/news/408322"],
  ["2026-07-31", 2_444_000, 2_462_000, null, null, "derived from 2026-08-03 (+24,000)"],
  ["2026-08-03", 2_468_000, 2_486_000, null, null, "imlebanon.org 2026-08-03"],
  ["2026-08-07", 2_461_000, 2_479_000, null, null, "derived from 2026-08-11 (−6,000)"],
  ["2026-08-11", 2_455_000, 2_473_000, null, null, "safiralchamal.com 2026-08-11"],
  ["2026-08-14", 2_458_000, 2_476_000, null, null, "dailybeirut.com 2026-08-14"],
  ["2026-08-18", 2_456_000, 2_474_000, null, null, "derived from 2026-08-21 (+15,000)"],
  ["2026-08-21", 2_471_000, 2_489_000, null, null, "almodon.com 2026-08-21"],
  ["2026-09-01", 2_571_000, 2_589_000, null, null, "derived from 2026-09-04 (+31,000)"],
  ["2026-09-04", 2_602_000, 2_620_000, null, null, "almodon.com 2026-09-04"],
  ["2026-09-08", 2_630_000, 2_648_000, null, null, "almodon.com 2026-09-08"],
  ["2026-09-11", 2_679_000, 2_697_000, null, null, "almodon.com 2026-09-11"],
  ["2026-09-15", 2_718_000, 2_736_000, null, null, "almodon.com 2026-09-15"],
  ["2026-09-18", 2_810_000, 2_828_000, null, null, "derived from 2026-09-22 (+24,000)"],
  ["2026-09-22", 2_834_000, 2_852_000, null, null, "almodon.com / almanar.com.lb 2026-09-22"],
  ["2026-09-25", 2_845_000, 2_863_000, null, null, "derived from 2026-09-29 (−1,000)"],
  ["2026-09-29", 2_844_000, 2_862_000, null, null, "almodon.com 2026-09-29"],
  ["2026-10-02", 2_837_000, 2_854_000, null, null, "almodon.com 2026-10-02"],
  ["2026-10-06", 2_825_000, 2_843_000, null, null, "saidaonline.com/321089"],
  ["2026-10-09", 2_802_000, 2_820_000, null, null, "safiralchamal.com 2026-10-09"],
  ["2026-10-13", 2_795_000, 2_813_000, null, null, "derived from 2026-10-16 (−22,000)"],
  ["2026-10-16", 2_773_000, 2_791_000, null, null, "saidaonline.com/321339"],
  ["2026-10-20", 2_739_000, 2_757_000, 2_563_000, 1_494_000, "iptgroup.com.lb (read 2026-10-22)"],
  ["2026-10-23", 2_686_000, 2_704_000, 2_564_000, 1_494_000, "imlebanon.org 2026-10-23 (−53,000)"],
  ["2026-10-30", 2_611_000, 2_629_000, 2_608_000, 1_545_000, "iptgroup.com.lb (price history from your project, 2026-10-30)"],
];

const MIN_QUOTE = 200_000;      // rejects parser accidents
const MAX_QUOTE = 50_000_000;
const LOAD_TTL_MS = 60_000;     // how often a running instance re-reads the DB

const validQuote = (n) => Number.isFinite(n) && n >= MIN_QUOTE && n <= MAX_QUOTE;
const validLpg = (n) => Number.isFinite(n) && n >= 10_000 && n <= MAX_QUOTE;
const isIso = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "YYYY-MM-DD" → { unl95, unl98, diesel, lpg, source } */
const store = new Map();
SEED.forEach(([date, unl95, unl98, diesel, lpg, source]) =>
  store.set(date, { unl95, unl98, diesel, lpg, source: `seed: ${source}` }));

let checkedAt = 0;       // ms — last successful IPT read
let loadedAt = 0;
let loading = null;

/* ---------------- database ---------------- */
async function load() {
  if (!db.enabled()) return;
  if (loadedAt && Date.now() - loadedAt < LOAD_TTL_MS) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      await db.ensureSchema();
      const hist = await db.query(
        "SELECT to_char(price_date,'YYYY-MM-DD') AS d, unl95, unl98, diesel, lpg, source FROM fuel_price_history");
      for (const r of hist.rows) {
        if (!validQuote(Number(r.unl95))) continue;
        store.set(r.d, {
          unl95: Number(r.unl95),
          unl98: r.unl98 != null ? Number(r.unl98) : null,
          diesel: r.diesel != null ? Number(r.diesel) : null,
          lpg: r.lpg != null ? Number(r.lpg) : null,
          source: r.source,
        });
      }
      const sync = await db.query("SELECT checked_at FROM fuel_sync WHERE id = 1");
      if (sync.rows[0]) checkedAt = Math.max(checkedAt, new Date(sync.rows[0].checked_at).getTime());
      loadedAt = Date.now();
    } catch (e) {
      console.warn("[history] database unavailable, using memory only:", e.message);
      loadedAt = Date.now() - LOAD_TTL_MS + 15_000; // retry in 15 s
    } finally {
      loading = null;
    }
  })();
  return loading;
}

async function persist(date) {
  if (!db.enabled()) return;
  const r = store.get(date);
  if (!r) return;
  try {
    await db.ensureSchema();
    await db.query(
      `INSERT INTO fuel_price_history (price_date, unl95, unl98, diesel, lpg, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (price_date) DO UPDATE SET unl95 = EXCLUDED.unl95, unl98 = EXCLUDED.unl98,
         diesel = EXCLUDED.diesel, lpg = EXCLUDED.lpg, source = EXCLUDED.source, recorded_at = now()`,
      [date, r.unl95, r.unl98, r.diesel, r.lpg, r.source]);
  } catch (e) {
    console.warn("[history] could not save prices:", e.message);
  }
}

/** Remember that IPT was read successfully just now. */
async function markChecked(priceDate) {
  checkedAt = Date.now();
  if (!db.enabled()) return;
  try {
    await db.ensureSchema();
    await db.query(
      `INSERT INTO fuel_sync (id, checked_at, price_date) VALUES (1, now(), $1)
       ON CONFLICT (id) DO UPDATE SET checked_at = now(), price_date = EXCLUDED.price_date`,
      [isIso(priceDate) ? priceDate : null]);
  } catch (e) {
    console.warn("[history] could not save sync time:", e.message);
  }
}

/* ---------------- public API ---------------- */

/**
 * Stores a table read from IPT in memory (call persist() to save it).
 * @returns {{write: boolean, changed: boolean}}
 *   changed — the prices are new or different;
 *   write   — worth saving (changed, or a live copy replacing a seed row)
 */
function record(date, prices, source) {
  if (!isIso(date) || !prices || !validQuote(Number(prices.unl95))) return { write: false, changed: false };
  const prev = store.get(date);
  const pick = (n, ok, old) => (ok(Number(n)) ? Math.round(Number(n)) : old ?? null);
  const rec = {
    unl95: Math.round(Number(prices.unl95)),
    unl98: pick(prices.unl98, validQuote, prev && prev.unl98),
    diesel: pick(prices.diesel, validQuote, prev && prev.diesel),
    lpg: pick(prices.lpg, validLpg, prev && prev.lpg),
    source,
  };
  const changed = !prev || ["unl95", "unl98", "diesel", "lpg"].some((k) => prev[k] !== rec[k]);
  const write = changed || String(prev.source).startsWith("seed");
  store.set(date, rec);
  return { write, changed };
}

/** Every known table, oldest first. */
function all() {
  return [...store.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, r]) => ({ date, ...r }));
}

const getCheckedAt = () => checkedAt;

module.exports = { load, persist, markChecked, record, all, getCheckedAt, SEED };
