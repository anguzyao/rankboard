-- ============================================================
-- 0009_add_workspaces.sql
--
-- 建立無登入 Workspace
--
-- Workspace 是使用者自己的資料空間。
--
-- 使用者不需要：
--   - 登入
--   - 註冊
--   - Email
--   - 密碼
--
-- 瀏覽器第一次使用時，由 Worker 自動建立 Workspace，
-- 並透過 HttpOnly Cookie 保存 Workspace Token。
--
-- 舊的 management_devices / device_sessions 暫時保留。
-- ============================================================


-- ============================================================
-- Workspace
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- SHA-256(workspace token)
  workspace_token_hash TEXT NOT NULL UNIQUE,

  -- 舊裝置對應。
  -- 新建立的 Workspace 為 NULL。
  --
  -- 這個欄位只是讓我們可以把目前已存在的
  -- management_devices 資料安全地遷移過來。
  legacy_management_device_id INTEGER UNIQUE,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- ============================================================
-- Workspace Index
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_workspaces_legacy_device
ON workspaces (
  legacy_management_device_id
);


-- ============================================================
-- Participants → Workspace
-- ============================================================

ALTER TABLE participants
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_participants_workspace
ON participants (
  workspace_id
);


-- ============================================================
-- Competitions → Workspace
-- ============================================================

ALTER TABLE competitions
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_competitions_workspace
ON competitions (
  workspace_id
);


-- ============================================================
-- Tournaments → Workspace
-- ============================================================

ALTER TABLE tournaments
ADD COLUMN workspace_id INTEGER;


CREATE INDEX IF NOT EXISTS
idx_tournaments_workspace
ON tournaments (
  workspace_id
);


-- ============================================================
-- 舊 Device → Workspace
--
-- 每一個既有 management_device 建立一個 Workspace。
--
-- 原本的 management_devices.token_hash
-- 可以直接作為 Workspace 的識別 Token Hash。
--
-- 這樣現有測試資料不會全部失去歸屬。
-- ============================================================

INSERT INTO workspaces (
  workspace_token_hash,
  legacy_management_device_id,
  created_at,
  updated_at
)
SELECT
  md.token_hash,
  md.id,
  md.created_at,
  md.last_seen_at
FROM management_devices md
WHERE NOT EXISTS (
  SELECT 1
  FROM workspaces w
  WHERE w.legacy_management_device_id = md.id
);


-- ============================================================
-- 將現有資料搬到對應 Workspace
-- ============================================================

UPDATE participants
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.legacy_management_device_id =
        participants.management_device_id
)
WHERE management_device_id IS NOT NULL
  AND workspace_id IS NULL;


UPDATE competitions
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.legacy_management_device_id =
        competitions.management_device_id
)
WHERE management_device_id IS NOT NULL
  AND workspace_id IS NULL;


UPDATE tournaments
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.legacy_management_device_id =
        tournaments.management_device_id
)
WHERE management_device_id IS NOT NULL
  AND workspace_id IS NULL;


-- ============================================================
-- Workspace Index
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_workspaces_created
ON workspaces (
  created_at
);
