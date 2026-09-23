-- ============================================================
-- 0004_add_device_management.sql
--
-- 裝置管理權
--
-- 邏輯：
-- 1. 建立賽程的裝置會取得一組隨機管理憑證
-- 2. 憑證只儲存雜湊值
-- 3. 後續只有持有該憑證的裝置可以管理自己的賽程
-- 4. 不需要會員、Email、密碼
-- ============================================================


-- ============================================================
-- 管理裝置
-- ============================================================

CREATE TABLE IF NOT EXISTS management_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  token_hash TEXT NOT NULL UNIQUE,

  created_at TEXT NOT NULL,

  last_seen_at TEXT NOT NULL
);


-- ============================================================
-- 賽程綁定管理裝置
-- ============================================================

ALTER TABLE tournaments
ADD COLUMN management_device_id INTEGER;


-- ============================================================
-- 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_management_devices_token_hash
ON management_devices (
  token_hash
);


CREATE INDEX IF NOT EXISTS
idx_tournaments_management_device
ON tournaments (
  management_device_id
);
