-- =========================
-- 比賽設定
-- =========================

CREATE TABLE competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- =========================
-- 各競賽分數
-- =========================

CREATE TABLE competition_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,

  UNIQUE (
    competition_id,
    participant_id
  ),

  FOREIGN KEY (
    competition_id
  )
  REFERENCES competitions(id)
  ON DELETE CASCADE,

  FOREIGN KEY (
    participant_id
  )
  REFERENCES participants(id)
  ON DELETE CASCADE
);


-- =========================
-- 各競賽排名歷史
-- =========================

CREATE TABLE competition_ranking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  created_at TEXT NOT NULL,

  FOREIGN KEY (
    competition_id
  )
  REFERENCES competitions(id)
  ON DELETE CASCADE,

  FOREIGN KEY (
    participant_id
  )
  REFERENCES participants(id)
  ON DELETE CASCADE
);


-- =========================
-- 網站設定
-- 用來儲存「比賽排名」標題
-- =========================

CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- =========================
-- 預設網站標題
-- =========================

INSERT INTO site_settings (
  key,
  value,
  updated_at
)
VALUES (
  'site_title',
  '比賽排名',
  datetime('now')
);


-- =========================
-- Index
-- =========================

CREATE INDEX idx_competition_scores_competition
ON competition_scores (
  competition_id
);

CREATE INDEX idx_competition_scores_participant
ON competition_scores (
  participant_id
);

CREATE INDEX idx_competition_history_competition
ON competition_ranking_history (
  competition_id
);

CREATE INDEX idx_competition_history_participant
ON competition_ranking_history (
  participant_id
);
