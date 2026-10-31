-- v0.6: strict, global UTC-day admission budget for NEW unique visit receipts.
-- This is an additive guard. It never rewrites a counter's existing hits.
-- Each accepted request_window row also updates counters.hits (0002 trigger)
-- and this global budget: approximately three D1 row writes per new visit.
-- 20,000 admitted visits per UTC day = at most ~60,000 such writes/day,
-- leaving headroom within a Free plan's 100,000 D1 rows-written/day quota.
--
-- Cloudflare's per-location rate limit binding independently stops high
-- request bursts BEFORE D1; this trigger is the authoritative global guard.
-- Exceeding the budget ignores only the new receipt; SVG remains readable.
CREATE TABLE IF NOT EXISTS visit_day_budget (
  utc_day INTEGER PRIMARY KEY NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted >= 0 AND accepted <= 20000)
);

-- Seed from existing receipts on first migration to avoid resetting the
-- current UTC day's allowance on a Worker redeployment or upgrade.
INSERT OR IGNORE INTO visit_day_budget (utc_day, accepted)
SELECT CAST(bucket / 288 AS INTEGER), MIN(COUNT(*), 20000)
FROM request_windows
GROUP BY CAST(bucket / 288 AS INTEGER);

CREATE TRIGGER IF NOT EXISTS cap_unique_visits_by_utc_day
BEFORE INSERT ON request_windows
WHEN COALESCE((
  SELECT accepted FROM visit_day_budget
  WHERE utc_day = CAST(NEW.bucket / 288 AS INTEGER)
), 0) >= 20000
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER IF NOT EXISTS record_admitted_visit_day
AFTER INSERT ON request_windows
BEGIN
  INSERT INTO visit_day_budget (utc_day, accepted)
  VALUES (CAST(NEW.bucket / 288 AS INTEGER), 1)
  ON CONFLICT(utc_day) DO UPDATE SET accepted = accepted + 1;
END;
