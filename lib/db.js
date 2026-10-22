/* =====================================================================
   db.js — PostgreSQL (optional). Without DATABASE_URL the app still
   works from the built-in price history; it just can't remember new
   prices between restarts.
   The pool is created lazily so it suits both a long-running Docker
   container and a short-lived Vercel function.
   ===================================================================== */
"use strict";

let pool = null;
let schemaReady = null;

const enabled = () => Boolean(process.env.DATABASE_URL);

// Same statements as db/schema.sql (kept inline so Vercel's bundler
// never has to find a loose .sql file).
const DDL = `
  CREATE TABLE IF NOT EXISTS fuel_price_history (
    price_date  DATE PRIMARY KEY,
    unl95       INTEGER NOT NULL,
    unl98       INTEGER,
    diesel      INTEGER,
    lpg         INTEGER,
    source      TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS fuel_sync (
    id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    checked_at TIMESTAMPTZ NOT NULL,
    price_date DATE
  );`;

/** Splits the URL so we decide TLS ourselves (Neon needs it, local Docker has none). */
function connectionConfig() {
  const raw = process.env.DATABASE_URL;
  let connectionString = raw;
  let mode = null;
  let host = "";
  try {
    const u = new URL(raw);
    host = u.hostname;
    mode = u.searchParams.get("sslmode");
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch { /* leave the string untouched */ }

  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "db", "postgres"].includes(host);
  let ssl;
  if (process.env.PGSSL === "disable" || mode === "disable") ssl = false;
  else if (process.env.PGSSL === "require" || (mode && mode !== "disable") || !local) ssl = { rejectUnauthorized: false };
  else ssl = false;
  return { connectionString, ssl };
}

function getPool() {
  if (!pool) {
    const { Pool } = require("pg");
    const { connectionString, ssl } = connectionConfig();
    pool = new Pool({
      connectionString,
      ssl,
      max: Number(process.env.PGPOOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 6_000,
    });
    // Idle connections get dropped by Neon routinely; without a listener
    // that would crash the process.
    pool.on("error", (e) => console.warn("[db] idle client error:", e.message));
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

/** Creates the tables once per process. */
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = query(DDL).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

async function close() {
  if (pool) { const p = pool; pool = null; schemaReady = null; await p.end().catch(() => {}); }
}

module.exports = { enabled, query, ensureSchema, close, DDL };
