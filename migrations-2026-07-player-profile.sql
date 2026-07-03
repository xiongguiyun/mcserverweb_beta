ALTER TABLE users ADD COLUMN skin_image TEXT;
ALTER TABLE users ADD COLUMN username_updated_at TEXT;

CREATE TABLE IF NOT EXISTS player_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_player_reports_status ON player_reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_reports_unique_open ON player_reports(reported_user_id, reporter_id) WHERE status = 'open';
