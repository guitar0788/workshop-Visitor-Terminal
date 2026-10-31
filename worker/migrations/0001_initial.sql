-- Initial schema for the server-side visitor counter.
-- Use Wrangler's migrations workflow; do not apply to production without review.
CREATE TABLE IF NOT EXISTS counters (
  slug TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0 CHECK(hits >= 0),
  design_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  baseline_hits INTEGER NOT NULL DEFAULT 0 CHECK(baseline_hits >= 0),
  baseline_source TEXT,
  baseline_captured_at TEXT,
  baseline_applied_at TEXT
);

-- Stores a short-lived, pseudonymous HMAC digest per counter and time window.
-- No raw IP addresses, User-Agent strings or other request headers are stored.
CREATE TABLE IF NOT EXISTS request_windows (
  slug TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  PRIMARY KEY (slug, fingerprint, bucket),
  FOREIGN KEY (slug) REFERENCES counters(slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_windows_bucket ON request_windows(bucket);
