-- ============================================================
-- 0003_add_match_play_order.sql
--
-- 新增實際比賽順序
--
-- round / position：
--   → 用來描述 bracket 結構
--
-- play_order：
--   → 用來決定實際「第幾場」進行
--
-- 兩者完全分開，避免隨機比賽順序破壞 bracket 結構。
-- ============================================================


-- ============================================================
-- 新增實際比賽順序
-- ============================================================

ALTER TABLE tournament_matches
ADD COLUMN play_order INTEGER;


-- ============================================================
-- 舊賽事資料初始化
--
-- 已經存在的賽事先依：
--   round → position
--
-- 建立一個合理的初始順序。
--
-- 新功能上線後，新建立的賽事會由後端正式分配 play_order。
-- ============================================================

UPDATE tournament_matches
SET play_order = (
  SELECT COUNT(*)
  FROM tournament_matches AS m2
  WHERE m2.tournament_id = tournament_matches.tournament_id
    AND (
      m2.round < tournament_matches.round
      OR (
        m2.round = tournament_matches.round
        AND m2.position <= tournament_matches.position
      )
    )
);


-- ============================================================
-- 建立索引
--
-- 之後取得某一賽事的比賽順序時，
-- 可以直接按照 play_order 查詢。
-- ============================================================

CREATE INDEX idx_tournament_matches_play_order
ON tournament_matches (
  tournament_id,
  play_order
);
