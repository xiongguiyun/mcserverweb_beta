ALTER TABLE posts ADD COLUMN highlighted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE post_reports ADD COLUMN resolution_reason TEXT;
ALTER TABLE post_reports ADD COLUMN punishment_type TEXT;
ALTER TABLE post_reports ADD COLUMN punishment_expires_at TEXT;

ALTER TABLE comment_reports ADD COLUMN resolution_reason TEXT;
ALTER TABLE comment_reports ADD COLUMN punishment_type TEXT;
ALTER TABLE comment_reports ADD COLUMN punishment_expires_at TEXT;

ALTER TABLE player_reports ADD COLUMN resolution_reason TEXT;
ALTER TABLE player_reports ADD COLUMN punishment_type TEXT;
ALTER TABLE player_reports ADD COLUMN punishment_expires_at TEXT;

CREATE TABLE IF NOT EXISTS user_punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('account_ban', 'comment_ban', 'post_ban', 'site_ban')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_punishments_active ON user_punishments(user_id, type, expires_at, revoked_at);
