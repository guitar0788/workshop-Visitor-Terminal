-- v0.5: login and user ownership; legacy/admin counters remain unclaimed.
-- Never auto-assign owner_user_id from the mutable owner/login string.
ALTER TABLE counters ADD COLUMN owner_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_counters_verified_owner ON counters(owner_user_id);

-- OAuth state is hashed, rate-limited by a short-lived HMAC source fingerprint.
CREATE TABLE IF NOT EXISTS publish_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  challenge TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_oauth_sources ON publish_oauth_states(source_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_oauth_expiry ON publish_oauth_states(expires_at);

-- Tickets are one-use and PKCE-bound; no GitHub access token is persisted.
CREATE TABLE IF NOT EXISTS publish_login_tickets (
  ticket_hash TEXT PRIMARY KEY NOT NULL,
  challenge TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_ticket_expiry ON publish_login_tickets(expires_at);

-- Session bearer tokens are hashed; browser holds raw token only in memory.
CREATE TABLE IF NOT EXISTS publish_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_session_expiry ON publish_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_publish_session_owner ON publish_sessions(github_user_id);
