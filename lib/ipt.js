/* =====================================================================
   ipt.js — reads the weekly price box from the IPT Group website
   =====================================================================
   https://www.iptgroup.com.lb/ipt/en/our-stations/fuel-prices
       Weekly Fuel Prices   20 / 10 / 2026
       UNL 95    2,739,000 L.L.      UNL 98   2,757,000 L.L.
       Diesel    2,563,000 L.L.      Gas (LPG) 1,494,000 L.L.

   The server fetches the page (never the browser). The parser strips
   the HTML to visible text and reads "<product> <number> L.L." pairs
   plus the table's date, so a redesign of IPT's markup does not break
   it as long as the text still reads that way.
   ===================================================================== */
"use strict";

const SOURCE_NAME = "IPT Group";
// IPT_URL (optional) points the reader somewhere else — used by the tests.
const SOURCE_URLS = process.env.IPT_URL
  ? [process.env.IPT_URL]
  : [
    "https://www.iptgroup.com.lb/ipt/en/our-stations/fuel-prices",
    "https://www.iptgroup.com.lb/ipt/en/home",
  ];
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const PRODUCTS = [
  { key: "unl95", match: /UNL\s*-?\s*95|Unleaded\s*95|Gasoline\s*95|Octane\s*95/i },
  { key: "unl98", match: /UNL\s*-?\s*98|Unleaded\s*98|Gasoline\s*98|Octane\s*98/i },
  { key: "diesel", match: /Diesel(?:\s*Oil)?/i },
  { key: "lpg", match: /Gas\s*\(\s*LPG\s*\)|\bLPG\b|Gas\s*Cylinder/i },
];

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const toNumber = (s) => Number(String(s).replace(/[^\d]/g, ""));

function dmyToIso(d, m, y) {
  const dd = Number(d), mm = Number(m), yy = Number(y);
  const t = new Date(Date.UTC(yy, mm - 1, dd));
  if (t.getUTCFullYear() !== yy || t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function readProducts(scope) {
  const NUM = "([0-9]{1,3}(?:[,.\\s][0-9]{3})+|[0-9]{4,})";
  const prices = {};
  for (const p of PRODUCTS) {
    const re = new RegExp(`(?:${p.match.source})\\s*[:\\-–]?\\s*${NUM}\\s*(?:L\\.?\\s*L\\.?|LBP|ل\\.?\\s*ل)`, "i");
    const m = scope.match(re);
    if (!m) continue;
    const n = toNumber(m[1]);
    if (n >= 10_000 && n <= 100_000_000) prices[p.key] = n;
  }
  return prices;
}

/**
 * @returns {{date: string|null, prices: {unl95,unl98?,diesel?,lpg?}}|null}
 *          null unless UNL 95 and at least two other products were read
 */
function parseIptHtml(html) {
  const text = htmlToText(html);
  const scopes = [];
  const re = /(?:Weekly\s*)?Fuel\s*Prices/gi;
  let m;
  while ((m = re.exec(text)) && scopes.length < 12) scopes.push(text.slice(m.index, m.index + 1500));
  scopes.push(text);

  for (const scope of scopes) {
    const prices = readProducts(scope);
    if (prices.unl95 == null || Object.keys(prices).length < 3) continue;
    const dm = scope.match(/\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(20\d{2})\b/); // day/month/year
    return { date: dm ? dmyToIso(dm[1], dm[2], dm[3]) : null, prices };
  }
  return null;
}

async function fetchOne(url, timeoutMs) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FuelTransportCalculator/1.0)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en",
    },
  });
  if (!res.ok) throw new Error(`IPT responded ${res.status}`);
  const html = await res.text();
  if (html.length > MAX_HTML_BYTES) throw new Error("IPT page unexpectedly large");
  const parsed = parseIptHtml(html);
  if (!parsed) throw new Error("IPT page layout not recognised");
  return parsed;
}

/** Tries the prices page, then the home page. Throws if both fail. */
async function fetchIpt() {
  let lastErr;
  const budgets = [6000, 4000];
  for (let i = 0; i < SOURCE_URLS.length; i++) {
    try { return await fetchOne(SOURCE_URLS[i], budgets[i]); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

module.exports = { fetchIpt, parseIptHtml, SOURCE_NAME, SOURCE_URLS };
