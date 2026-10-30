"use strict";
// Needs a real PostgreSQL:  TEST_DATABASE_URL=postgresql://... npm test
// (skipped otherwise). Uses a fake IPT page, restarts the server, and checks
// that a price read from "IPT" survives the restart and changes the rate.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

const DB = process.env.TEST_DATABASE_URL;
const skip = DB ? false : "set TEST_DATABASE_URL to run the PostgreSQL test";

const page = (date, unl95, unl98, diesel, lpg) => `<html><body><h3>Weekly Fuel Prices</h3>${date}
  <p>UNL 95 ${unl95} L.L.</p><p>UNL 98 ${unl98} L.L.</p><p>Diesel ${diesel} L.L.</p><p>Gas (LPG) ${lpg} L.L.</p></body></html>`;

function startServer(port, extraEnv) {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: DB, FUEL_TODAY: "2026-10-24", ...extraEnv },
    stdio: "ignore",
  });
  return child;
}
async function waitUp(base) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

test("IPT price is recorded in PostgreSQL, survives a restart, and moves the rate", { skip }, async () => {
  const pg = new (require("pg").Pool)({ connectionString: DB });
  await pg.query("DROP TABLE IF EXISTS fuel_price_history, fuel_sync");

  // fake IPT: a new table dated 23/10/2026
  const ipt = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(page("23 / 10 / 2026", "2,700,000", "2,718,000", "2,500,000", "1,500,000"));
  });
  await new Promise((r) => ipt.listen(0, "127.0.0.1", r));
  const iptUrl = `http://127.0.0.1:${ipt.address().port}/prices`;

  const port = 3800 + Math.floor(Math.random() * 100);
  const base = `http://127.0.0.1:${port}`;
  let child = startServer(port, { IPT_URL: iptUrl });
  try {
    await waitUp(base);
    const j = await (await fetch(`${base}/api/summary?month=2026-10`)).json();
    assert.equal(j.prices.live, true);
    assert.equal(j.prices.tableDate, "2026-10-23");
    const f = Object.fromEntries(j.prices.fuels.map((x) => [x.key, x]));
    assert.equal(f.unl95.price, 2_700_000);
    assert.equal(f.diesel.price, 2_500_000);
    assert.equal(f.lpg.price, 1_500_000);
    assert.equal(f.unl95.change, -39_000);
    // the live 23 Oct table replaces the seed one in the average
    const seg = j.rate.segments.at(-1);
    assert.deepEqual([seg.tableDate, seg.unl95], ["2026-10-23", 2_700_000]);

    const rows = (await pg.query("SELECT to_char(price_date,'YYYY-MM-DD') d, unl95, diesel, lpg, source FROM fuel_price_history WHERE price_date >= '2026-10-20' ORDER BY 1")).rows;
    assert.deepEqual(rows.map((r) => r.d), ["2026-10-23"]);
    assert.equal(rows[0].unl95, 2_700_000);
    assert.match(rows[0].source, /IPT Group \(live\)/);
    assert.equal((await pg.query("SELECT count(*)::int c FROM fuel_sync")).rows[0].c, 1);

    // restart with IPT unreachable: the price must come back from the database
    child.kill(); await new Promise((r) => child.once("exit", r));
    child = startServer(port, { IPT_URL: "http://127.0.0.1:1/unreachable" });
    await waitUp(base);
    const k = await (await fetch(`${base}/api/summary?month=2026-10`)).json();
    assert.equal(k.prices.tableDate, "2026-10-23");
    assert.equal(k.rate.ratePerDay, j.rate.ratePerDay);
    assert.equal(k.prices.fuels.find((x) => x.key === "diesel").price, 2_500_000);
    assert.equal(k.prices.live, true, "last successful check was saved in the database");
  } finally {
    child.kill();
    ipt.close();
    await pg.end();
  }
});
