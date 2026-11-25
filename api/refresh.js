"use strict";
const service = require("../lib/service");

// POST /api/refresh — the "Refresh Prices" button
// GET  /api/refresh — the Vercel daily cron (vercel.json "crons"). Vercel crons ALWAYS send GET,
//                     so a POST-only route makes the cron do nothing and tables get missed.
// If CRON_SECRET is set in Vercel, the cron sends "Authorization: Bearer <CRON_SECRET>" and only
// that GET is accepted. Either way refresh() is throttled, so this cannot be used to hammer IPT.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const secret = process.env.CRON_SECRET;
  if (req.method === "GET" && secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await service.forceRefresh();
    if (req.method === "GET") console.log("[cron] refresh:", result.status, result.tableDate || "");
    return res.status(200).json(result);
  } catch (e) {
    console.error("[refresh] failed:", e && e.message);
    return res.status(500).json({ error: "Refresh failed" });
  }
};