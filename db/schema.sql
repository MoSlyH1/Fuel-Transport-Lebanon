-- =====================================================================
-- schema.sql — loaded by docker-compose on the first Postgres start.
-- lib/db.js runs the same statements on boot, so Neon / Vercel get the
-- tables too (everything is IF NOT EXISTS, so re-running is harmless).
-- =====================================================================

-- One row per official IPT price table, keyed by the date it took effect.
-- Petrol/diesel are L.L. per 20 litres, LPG is L.L. per cylinder.
CREATE TABLE IF NOT EXISTS fuel_price_history (
  price_date  DATE PRIMARY KEY,
  unl95       INTEGER NOT NULL,
  unl98       INTEGER,
  diesel      INTEGER,
  lpg         INTEGER,
  source      TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single row: when IPT was last read successfully (shared by all instances).
CREATE TABLE IF NOT EXISTS fuel_sync (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checked_at TIMESTAMPTZ NOT NULL,
  price_date DATE
);
