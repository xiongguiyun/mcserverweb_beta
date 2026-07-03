ALTER TABLE posts ADD COLUMN highlight_color TEXT;

CREATE TABLE IF NOT EXISTS comment_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  quote_comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  quote_author TEXT,
  quote_excerpt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comment_quotes_comment_order ON comment_quotes(comment_id, sort_order);
