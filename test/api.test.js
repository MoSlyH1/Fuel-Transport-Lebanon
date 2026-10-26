"use strict";
// Starts the real server (the same one Docker runs) and calls it over HTTP.
process.env.FUEL_TODAY = "2026-10-22";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

let child, base;

test.before(async () => {
  const port = 3200 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: "", HTTPS_PROXY: "", https_proxy: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
test.after(() => child && child.kill());

const get = async (p, init) => { const r = await fetch(base + p, init); return { r, j: await r.json().catch(() => null) }; };

test("summary: prices, rate, payslip and months", async () => {
  const { r, j } = await get("/api/summary?month=2026-10&days=26");
  assert.equal(r.status, 200);
  assert.equal(j.rate.fuelRatePerDay, 685_000);
  assert.equal(j.rate.ratePerDay, 685_000); // "500K–800K" button (from 22 Oct)
  assert.equal(j.rate.oldRatePerDay, 450_000); // "450K" button
  assert.equal(j.payslip.total, 17_810_000);
  const f = Object.fromEntries(j.prices.fuels.map((x) => [x.key, x]));
  assert.equal(f.unl95.price, 2_739_000);
  assert.equal(f.unl98.price, 2_757_000);
  assert.equal(f.diesel.price, 2_563_000);
  assert.equal(f.lpg.price, 1_494_000);
  assert.equal(f.unl95.change, -34_000);
  assert.equal(j.months[0].month, "2026-10");
  assert.equal(j.months.length, 4);
  assert.equal(j.prices.tableDate, "2026-10-20");
});

test("default month is the current month", async () => {
  const { j } = await get("/api/summary");
  assert.equal(j.rate.month, "2026-10");
});

test("rate endpoint accepts employees", async () => {
  const { j } = await get("/api/rate?month=2026-10&days=20&employees=3");
  assert.equal(j.payslip.total, 20 * 685_000 * 3);
});

test("bad input is rejected with 400", async () => {
  for (const q of ["month=2026-13", "month=abc", "days=40", "days=-1", "days=1.5", "employees=0"]) {
    const { r, j } = await get(`/api/summary?${q}`);
    assert.equal(r.status, 400, q);
    assert.ok(j.error);
  }
});

test("refresh never crashes when IPT is unreachable", async () => {
  const { r, j } = await get("/api/refresh", { method: "POST" });
  assert.equal(r.status, 200);
  assert.ok(["failed", "updated", "unchanged", "throttled"].includes(j.status));
  assert.equal(j.tableDate, "2026-10-20");
});

test("wrong method and unknown paths", async () => {
  assert.equal((await get("/api/summary", { method: "POST" })).r.status, 405);
  assert.equal((await get("/api/nope")).r.status, 404);
});

test("static files are served and path traversal is blocked", async () => {
  const html = await fetch(base + "/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Fuel &amp; Transport/);
  assert.equal((await fetch(base + "/app.js")).status, 200);
  assert.equal((await fetch(base + "/style.css")).status, 200);
  // raw paths (fetch would tidy them up before sending)
  const raw = (p) => new Promise((resolve, reject) => {
    const u = new URL(base);
    require("node:http").get({ host: u.hostname, port: u.port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(await raw("/..%2fpackage.json"), 403);
  for (const p of ["/%2e%2e/server.js", "/../server.js", "/..%5cserver.js"]) {
    assert.ok([403, 404].includes(await raw(p)), p); // never served
  }
  assert.equal(await raw("/a%00b"), 400);
  assert.equal((await fetch(base + "/missing.txt")).status, 404);
});