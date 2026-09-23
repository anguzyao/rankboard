-- =========================
-- 賽事
-- =========================

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  format TEXT NOT NULL
    CHECK (format IN ('single_elimination', 'double_elimination')),
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  champion_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);


-- =========================
-- 賽事參賽者
-- 獨立於排行榜的 participants,允許臨時輸入的名字
-- =========================

CREATE TABLE tournament_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seed INTEGER NOT NULL,
  source_participant_id INTEGER,
  created_at TEXT NOT NULL,

  FOREIGN KEY (tournament_id)
  REFERENCES tournaments(id)
  ON DELETE CASCADE
);


-- =========================
-- 賽事對戰
-- =========================

CREATE TABLE tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,

  bracket TEXT NOT NULL
    CHECK (bracket IN ('winners', 'losers', 'grand_final')),

  round INTEGER NOT NULL,
  position INTEGER NOT NULL,

  participant1_id INTEGER,
  participant2_id INTEGER,

  score1 INTEGER,
  score2 INTEGER,

  winner_id INTEGER,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'completed', 'void')),

  is_bye_match INTEGER NOT NULL DEFAULT 0,
  is_grand_final INTEGER NOT NULL DEFAULT 0,
  is_reset_match INTEGER NOT NULL DEFAULT 0,

  next_match_id INTEGER,
  next_match_slot INTEGER,

  loser_next_match_id INTEGER,
  loser_next_match_slot INTEGER,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (tournament_id)
  REFERENCES tournaments(id)
  ON DELETE CASCADE,

  FOREIGN KEY (participant1_id)
  REFERENCES tournament_participants(id)
  ON DELETE SET NULL,

  FOREIGN KEY (participant2_id)
  REFERENCES tournament_participants(id)
  ON DELETE SET NULL,

  FOREIGN KEY (winner_id)
  REFERENCES tournament_participants(id)
  ON DELETE SET NULL
);


-- =========================
-- Index
-- =========================

CREATE INDEX idx_tournament_participants_tournament
ON tournament_participants (tournament_id);

CREATE INDEX idx_tournament_matches_tournament
ON tournament_matches (tournament_id);

CREATE INDEX idx_tournament_matches_next
ON tournament_matches (next_match_id);

CREATE INDEX idx_tournament_matches_loser_next
ON tournament_matches (loser_next_match_id);
