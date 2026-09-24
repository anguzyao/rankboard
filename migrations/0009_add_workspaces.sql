-- ============================================================
-- 0009_create_workspaces.sql
--
-- Workspace 架構
--
-- 目標：
--   1. 不需要會員、Email、密碼。
--   2. 每個瀏覽器 / 裝置第一次使用時，
--      由 Worker 自動建立一個 Workspace。
--   3. Workspace 擁有自己的：
--        - participants
--        - competitions
--        - tournaments
--   4. 公開分享 URL 不依賴 Workspace Cookie。
--
-- 舊的 management_devices / device_sessions 系統先保留。
-- 舊的 management_device_id 欄位也先保留，方便平滑過渡。
--
-- 注意：
--   本 migration 不刪除任何舊欄位，也不刪除舊資料。
--   management_device_id = NULL 的舊資料不會自動猜測歸屬，
--   會暫時保持 NULL，後續由 Workspace 管理邏輯處理。
-- ============================================================


-- ============================================================
-- 1. Workspace
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- 舊裝置系統的對應關係。
  --
  -- 舊 management_device 會各自建立一個 Workspace。
  -- 新 Workspace 則為 NULL。
  legacy_management_device_id INTEGER UNIQUE,

  FOREIGN KEY (
    legacy_management_device_id
  )
  REFERENCES management_devices(id)
  ON DELETE SET NULL
);


CREATE INDEX IF NOT EXISTS
idx_workspaces_legacy_management_device
ON workspaces (
  legacy_management_device_id
);


-- ============================================================
-- 2. Workspace Session
--
-- 不使用登入帳號。
--
-- Worker 會：
--   random token
--       ↓
--   SHA-256
--       ↓
--   儲存 token_hash
--       ↓
--   HttpOnly Cookie
--
-- 因此資料庫不儲存 Cookie 明文 token。
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  workspace_id INTEGER NOT NULL,

  token_hash TEXT NOT NULL UNIQUE,

  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL,

  last_seen_at TEXT NOT NULL,

  FOREIGN KEY (
    workspace_id
  )
  REFERENCES workspaces(id)
  ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS
idx_workspace_sessions_token_hash
ON workspace_sessions (
  token_hash
);


CREATE INDEX IF NOT EXISTS
idx_workspace_sessions_workspace
ON workspace_sessions (
  workspace_id
);


-- ============================================================
-- 3. Participants → Workspace
-- ============================================================

ALTER TABLE participants
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_participants_workspace
ON participants (
  workspace_id
);


-- ============================================================
-- 4. Competitions → Workspace
-- ============================================================

ALTER TABLE competitions
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_competitions_workspace
ON competitions (
  workspace_id
);


-- ============================================================
-- 5. Tournaments → Workspace
-- ============================================================

ALTER TABLE tournaments
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_tournaments_workspace
ON tournaments (
  workspace_id
);


-- ============================================================
-- 6. 將既有 management_devices 對應成 Workspace
--
-- 例如：
--
-- management_devices
--   id = 1
--
-- 會建立：
--
-- workspaces
--   id = 1
--   legacy_management_device_id = 1
--
-- 不建立新的明文 Token。
-- 舊 device_session 仍由原本系統處理。
-- 新版 index.js 在辨識舊 device_session 後，
-- 可以找到對應 Workspace，再建立新的 workspace_session。
-- ============================================================

INSERT INTO workspaces (
  created_at,
  updated_at,
  legacy_management_device_id
)
SELECT
  md.created_at,
  md.last_seen_at,
  md.id
FROM management_devices AS md
WHERE NOT EXISTS (
  SELECT 1
  FROM workspaces AS w
  WHERE w.legacy_management_device_id = md.id
);


-- ============================================================
-- 7. 將已有「明確綁定 management_device」的資料
--    搬到對應 Workspace。
--
-- 只有有明確 owner 的資料才自動搬移。
-- management_device_id IS NULL 的資料不猜測 owner。
-- ============================================================

UPDATE participants
SET workspace_id = (
  SELECT w.id
  FROM workspaces AS w
  WHERE w.legacy_management_device_id =
        participants.management_device_id
)
WHERE participants.management_device_id IS NOT NULL
  AND participants.workspace_id IS NULL;


UPDATE competitions
SET workspace_id = (
  SELECT w.id
  FROM workspaces AS w
  WHERE w.legacy_management_device_id =
        competitions.management_device_id
)
WHERE competitions.management_device_id IS NOT NULL
  AND competitions.workspace_id IS NULL;


UPDATE tournaments
SET workspace_id = (
  SELECT w.id
  FROM workspaces AS w
  WHERE w.legacy_management_device_id =
        tournaments.management_device_id
)
WHERE tournaments.management_device_id IS NOT NULL
  AND tournaments.workspace_id IS NULL;


-- ============================================================
-- 8. Workspace 查詢 Index
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_workspaces_updated
ON workspaces (
  updated_at
);
