-- v0.4.1: increment in the same SQLite transaction as the request receipt.
-- A duplicate (slug, fingerprint, bucket) is ignored, so the trigger runs once.
-- This prevents a receipt from being recorded without the corresponding count update.
-- This is an additive migration; do not edit 0001_initial.sql after release.
CREATE TRIGGER IF NOT EXISTS count_new_window
AFTER INSERT ON request_windows
BEGIN
  UPDATE counters
     SET hits = hits + 1
   WHERE slug = NEW.slug AND hits < 999999999999;
END;
