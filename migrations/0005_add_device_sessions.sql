-- ============================================================
-- 0005_add_device_sessions.sql
--
-- 裝置管理 Session
-- ============================================================

CREATE TABLE IF NOT EXISTS device_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  device_id INTEGER NOT NULL,

  token TEXT NOT NULL UNIQUE,

  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL,

  FOREIGN KEY (
    device_id
  )
  REFERENCES management_devices(id)
  ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS
idx_device_sessions_token
ON device_sessions (
  token
);


CREATE INDEX IF NOT EXISTS
idx_device_sessions_device
ON device_sessions (
  device_id
);
