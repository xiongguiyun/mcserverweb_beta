ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN deleted_by INTEGER;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'cooling', 'cancelled', 'completed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  scheduled_at TEXT,
  cancelled_at TEXT,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_active ON account_deletion_requests(user_id) WHERE status IN ('pending_approval', 'cooling');
CREATE INDEX IF NOT EXISTS idx_account_deletion_due ON account_deletion_requests(status, scheduled_at);
