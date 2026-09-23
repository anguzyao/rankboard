// ============================================================
// tournaments.js
//
// 賽程安排器的 API。跟排行榜(index.js)完全獨立,
// 不會互相影響 — 排行榜可以照常運作,賽程功能也可以單獨使用。
//
// 路由(都掛在 /api/tournaments 底下):
//   GET    /api/tournaments
//   POST   /api/tournaments
//   GET    /api/tournaments/:id
//   DELETE /api/tournaments/:id
//   PATCH  /api/tournaments/:id/matches/:matchId
// ============================================================

import { generateBracket } from "./bracket-engine.js";

export async function handleTournamentRoutes(
  request,
  env,
  url,
  requireAdmin,
  jsonResponse
) {
  const path = url.pathname;

  // =========================
  // 列表
  // =========================
  if (path === "/api/tournaments" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT
        t.id, t.name, t.format, t.size, t.status,
        t.champion_id, t.created_at, t.updated_at,
        c.name AS champion_name
      FROM tournaments t
      LEFT JOIN tournament_participants c
        ON c.id = t.champion_id
      ORDER BY t.created_at DESC
    `).all();

    return jsonResponse({
      tournaments: rows.results || []
    });
  }

  // =========================
  // 建立新賽事
  // =========================
  if (path === "/api/tournaments" && request.method === "POST") {
    const session = await requireAdmin(request, env);

    if (!session) {
      return jsonResponse(
        { error: "未登入管理員帳號" },
        401
      );
    }

    const body = await request.json().catch(() => ({}));

    const name = String(body.name || "").trim();
    const format = String(body.format || "");
    const randomize = Boolean(body.randomize);

    let names = Array.isArray(body.participants)
      ? body.participants
          .map((n) => String(n || "").trim())
          .filter(Boolean)
      : [];

    if (!name) {
      return jsonResponse(
        { error: "賽事名稱不能為空白" },
        400
      );
    }

    if (
      !["single_elimination", "double_elimination"].includes(
        format
      )
    ) {
      return jsonResponse(
        { error: "賽制錯誤" },
        400
      );
    }

    if (names.length < 2 || names.length > 48) {
      return jsonResponse(
        { error: "參賽人數需介於 2 到 48 人" },
        400
      );
    }

    if (randomize) {
      names = shuffle(names);
    }

    const seedParticipants = names.map((n, i) => ({
      id: i + 1,
      name: n
    }));

    let generated;

    try {
      generated = generateBracket(
        seedParticipants,
        format
      );
    } catch (error) {
      return jsonResponse(
        {
          error:
            error.message ||
            "產生賽程失敗"
        },
        400
      );
    }

    const now = new Date().toISOString();

    // =========================
    // 建立賽事
    // =========================
    const tournamentInsert = await env.DB.prepare(`
      INSERT INTO tournaments (
        name,
        format,
        size,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'in_progress', ?, ?)
    `).bind(
      name,
      format,
      names.length,
      now,
      now
    ).run();

    const tournamentId =
      tournamentInsert.meta.last_row_id;

    // =========================
    // 建立參賽者
    // =========================
    const seedToDbId = new Map();

    for (const p of seedParticipants) {
      const res = await env.DB.prepare(`
        INSERT INTO tournament_participants (
          tournament_id,
          name,
          seed,
          created_at
        )
        VALUES (?, ?, ?, ?)
      `).bind(
        tournamentId,
        p.name,
        p.id,
        now
      ).run();

      seedToDbId.set(
        p.id,
        res.meta.last_row_id
      );
    }

    const resolveParticipant = (p) =>
      p
        ? seedToDbId.get(p.id) || null
        : null;

    // =========================
    // Phase A
    //
    // 先建立所有比賽。
    // 這時候 next_match_id 還不能寫,
    // 因為 DB id 尚未全部產生。
    // =========================
    const tempIdToDbId = new Map();

    for (const m of generated.matches) {
      const status =
        m.status ||
        (m.void ? "void" : "pending");

      const res = await env.DB.prepare(`
        INSERT INTO tournament_matches (
          tournament_id,
          bracket,
          round,
          position,
          participant1_id,
          participant2_id,
          winner_id,
          status,
          is_bye_match,
          is_grand_final,
          is_reset_match,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tournamentId,
        m.bracket,
        m.round,
        m.position,
        resolveParticipant(m.participant1),
        resolveParticipant(m.participant2),
        resolveParticipant(m.winner),
        status,
        m.isByeMatch ? 1 : 0,
        m.isGrandFinal ? 1 : 0,
        m.isResetMatch ? 1 : 0,
        now,
        now
      ).run();

      tempIdToDbId.set(
        m.id,
        res.meta.last_row_id
      );
    }

    // =========================
    // Phase B
    //
    // 補上比賽之間的連線關係
    // =========================
    for (const m of generated.matches) {
      if (
        !m.nextMatchId &&
        !m.loserNextMatchId
      ) {
        continue;
      }

      await env.DB.prepare(`
        UPDATE tournament_matches
        SET
          next_match_id = ?,
          next_match_slot = ?,
          loser_next_match_id = ?,
          loser_next_match_slot = ?
        WHERE id = ?
      `).bind(
        m.nextMatchId
          ? tempIdToDbId.get(m.nextMatchId)
          : null,

        m.nextMatchId
          ? m.nextMatchSlot
          : null,

        m.loserNextMatchId
          ? tempIdToDbId.get(
              m.loserNextMatchId
            )
          : null,

        m.loserNextMatchId
          ? m.loserNextMatchSlot
          : null,

        tempIdToDbId.get(m.id)
      ).run();
    }

    // ========================================================
    // Phase C
    //
    // 處理「建立賽程時就已經完成」的第一輪 Bye。
    //
    // bracket-engine.js 產生 Bye 時,
    // 該場會直接是 completed + winner。
    //
    // 但此時 next_match_id 已經建立完成,
    // 所以現在把 Bye 勝者推進下一場。
    //
    // 這就是 3、5、6、7、10、15、21... 人數
    // 能正常往下一輪晉級的關鍵。
    // ========================================================

    const initialByeRows =
      await env.DB.prepare(`
        SELECT
          id,
          winner_id,
          next_match_id,
          next_match_slot
        FROM tournament_matches
        WHERE tournament_id = ?
          AND status = 'completed'
          AND is_bye_match = 1
          AND winner_id IS NOT NULL
          AND next_match_id IS NOT NULL
      `)
        .bind(tournamentId)
        .all();

    const initialByeQueue = (
      initialByeRows.results || []
    ).map((row) => ({
      matchId: row.next_match_id,
      slot: row.next_match_slot,
      participantId: row.winner_id
    }));

    if (initialByeQueue.length > 0) {
      await propagate(
        env,
        initialByeQueue
      );
    }

    return jsonResponse({
      success: true,
      tournamentId
    });
  }

  // =========================
  // 單一賽事詳細資料
  // =========================
  const detailMatch =
    path.match(
      /^\/api\/tournaments\/(\d+)$/
    );

  if (
    detailMatch &&
    request.method === "GET"
  ) {
    const tournamentId =
      Number(detailMatch[1]);

    const detail =
      await getTournamentDetail(
        env,
        tournamentId
      );

    if (!detail) {
      return jsonResponse(
        { error: "找不到這個賽事" },
        404
      );
    }

    return jsonResponse(detail);
  }

  // =========================
  // 刪除賽事
  // =========================
  if (
    detailMatch &&
    request.method === "DELETE"
  ) {
    const session =
      await requireAdmin(
        request,
        env
      );

    if (!session) {
      return jsonResponse(
        { error: "未登入管理員帳號" },
        401
      );
    }

    const tournamentId =
      Number(detailMatch[1]);

    await env.DB.prepare(`
      DELETE FROM tournaments
      WHERE id = ?
    `)
      .bind(tournamentId)
      .run();

    return jsonResponse({
      success: true
    });
  }

  // =========================
  // 登錄比賽結果
  // =========================
  const matchResultMatch =
    path.match(
      /^\/api\/tournaments\/(\d+)\/matches\/(\d+)$/
    );

  if (
    matchResultMatch &&
    request.method === "PATCH"
  ) {
    const session =
      await requireAdmin(
        request,
        env
      );

    if (!session) {
      return jsonResponse(
        { error: "未登入管理員帳號" },
        401
      );
    }

    const tournamentId =
      Number(matchResultMatch[1]);

    const matchId =
      Number(matchResultMatch[2]);

    const body =
      await request.json().catch(
        () => ({})
      );

    const winnerId =
      Number(body.winnerId);

    const score1 =
      body.score1 === undefined ||
      body.score1 === null
        ? null
        : Number(body.score1);

    const score2 =
      body.score2 === undefined ||
      body.score2 === null
        ? null
        : Number(body.score2);

    const match =
      await env.DB.prepare(`
        SELECT *
        FROM tournament_matches
        WHERE id = ?
          AND tournament_id = ?
      `)
        .bind(
          matchId,
          tournamentId
        )
        .first();

    if (!match) {
      return jsonResponse(
        { error: "找不到這場比賽" },
        404
      );
    }

    if (match.status === "completed") {
      return jsonResponse(
        { error: "這場比賽已經有結果了" },
        400
      );
    }

    if (
      !match.participant1_id ||
      !match.participant2_id ||
      (
        winnerId !== match.participant1_id &&
        winnerId !== match.participant2_id
      )
    ) {
      return jsonResponse(
        {
          error:
            "勝方必須是這場比賽的其中一位參賽者"
        },
        400
      );
    }

    const loserId =
      winnerId === match.participant1_id
        ? match.participant2_id
        : match.participant1_id;

    await completeMatch(env, {
      matchId,
      winnerId,
      loserId,
      score1,
      score2
    });

    await handleSpecialMatchCompletion(
      env,
      tournamentId,
      match,
      winnerId
    );

    return jsonResponse({
      success: true
    });
  }

  return null;
}


// ============================================================
// 完成一場比賽
// ============================================================

async function completeMatch(
  env,
  {
    matchId,
    winnerId,
    loserId,
    score1,
    score2
  }
) {
  const now =
    new Date().toISOString();

  await env.DB.prepare(`
    UPDATE tournament_matches
    SET
      winner_id = ?,
      score1 = ?,
      score2 = ?,
      status = 'completed',
      updated_at = ?
    WHERE id = ?
  `).bind(
    winnerId,
    score1,
    score2,
    now,
    matchId
  ).run();

  const match =
    await env.DB.prepare(`
      SELECT *
      FROM tournament_matches
      WHERE id = ?
    `)
      .bind(matchId)
      .first();

  const queue = [];

  // 勝者 → 勝部下一場
  if (match.next_match_id) {
    queue.push({
      matchId:
        match.next_match_id,
      slot:
        match.next_match_slot,
      participantId:
        winnerId
    });
  }

  // 敗者 → 敗部下一場
  if (
    loserId &&
    match.loser_next_match_id
  ) {
    queue.push({
      matchId:
        match.loser_next_match_id,
      slot:
        match.loser_next_match_slot,
      participantId:
        loserId
    });
  }

  await propagate(
    env,
    queue
  );
}


// ============================================================
// 傳遞參賽者
//
// queue:
// {
//   matchId,
//   slot,
//   participantId
// }
//
// slot = 1 → participant1_id
// slot = 2 → participant2_id
// ============================================================

async function propagate(
  env,
  queue
) {
  const now =
    new Date().toISOString();

  while (queue.length > 0) {
    const {
      matchId,
      slot,
      participantId
    } = queue.shift();

    if (!matchId) {
      continue;
    }

    const target =
      await env.DB.prepare(`
        SELECT *
        FROM tournament_matches
        WHERE id = ?
      `)
        .bind(matchId)
        .first();

    if (
      !target ||
      target.status === "completed" ||
      target.status === "void"
    ) {
      continue;
    }

    const column =
      slot === 1
        ? "participant1_id"
        : "participant2_id";

    await env.DB.prepare(`
      UPDATE tournament_matches
      SET
        ${column} = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        participantId,
        now,
        matchId
      )
      .run();

    const p1 =
      column === "participant1_id"
        ? participantId
        : target.participant1_id;

    const p2 =
      column === "participant2_id"
        ? participantId
        : target.participant2_id;

    // ========================================================
    // Bye
    // ========================================================
    if (target.is_bye_match) {
      const solo =
        p1 || p2;

      if (
        solo &&
        !(p1 && p2)
      ) {
        await env.DB.prepare(`
          UPDATE tournament_matches
          SET
            winner_id = ?,
            status = 'completed',
            updated_at = ?
          WHERE id = ?
        `)
          .bind(
            solo,
            now,
            matchId
          )
          .run();

        // Bye 勝者繼續往下一場
        if (target.next_match_id) {
          queue.push({
            matchId:
              target.next_match_id,
            slot:
              target.next_match_slot,
            participantId:
              solo
          });
        }
      }

      continue;
    }

    // ========================================================
    // 雙方都到位 → ready
    // ========================================================
    if (p1 && p2) {
      await env.DB.prepare(`
        UPDATE tournament_matches
        SET
          status = 'ready',
          updated_at = ?
        WHERE id = ?
      `)
        .bind(
          now,
          matchId
        )
        .run();
    }
  }
}


// ============================================================
// 處理特殊比賽
//
// 1. 單淘汰決賽
// 2. 雙敗 Grand Final
// 3. Grand Final Reset
// ============================================================

async function handleSpecialMatchCompletion(
  env,
  tournamentId,
  match,
  winnerId
) {
  const now =
    new Date().toISOString();

  // ========================================================
  // 單淘汰
  // ========================================================
  if (
    match.bracket === "winners" &&
    !match.is_grand_final &&
    !match.next_match_id
  ) {
    const tournament =
      await env.DB.prepare(`
        SELECT format
        FROM tournaments
        WHERE id = ?
      `)
        .bind(tournamentId)
        .first();

    if (
      tournament?.format ===
      "single_elimination"
    ) {
      await env.DB.prepare(`
        UPDATE tournaments
        SET
          status = 'completed',
          champion_id = ?,
          updated_at = ?
        WHERE id = ?
      `)
        .bind(
          winnerId,
          now,
          tournamentId
        )
        .run();
    }

    return;
  }

  // ========================================================
  // 雙敗 Grand Final
  // ========================================================
  if (
    match.is_grand_final &&
    !match.is_reset_match
  ) {
    if (
      winnerId ===
      match.participant1_id
    ) {
      // 勝部側獲勝
      // → 直接完成賽事
      await env.DB.prepare(`
        UPDATE tournaments
        SET
          status = 'completed',
          champion_id = ?,
          updated_at = ?
        WHERE id = ?
      `)
        .bind(
          winnerId,
          now,
          tournamentId
        )
        .run();

      const reset =
        await findResetMatch(
          env,
          tournamentId,
          match.id
        );

      if (reset) {
        await env.DB.prepare(`
          UPDATE tournament_matches
          SET
            status = 'void',
            updated_at = ?
          WHERE id = ?
        `)
          .bind(
            now,
            reset.id
          )
          .run();
      }
    } else {
      // 敗部側獲勝
      // → 啟動 Reset
      const reset =
        await findResetMatch(
          env,
          tournamentId,
          match.id
        );

      if (reset) {
        await env.DB.prepare(`
          UPDATE tournament_matches
          SET
            participant1_id = ?,
            participant2_id = ?,
            status = 'ready',
            updated_at = ?
          WHERE id = ?
        `)
          .bind(
            match.participant1_id,
            match.participant2_id,
            now,
            reset.id
          )
          .run();
      }
    }

    return;
  }

  // ========================================================
  // 雙敗 Reset
  // ========================================================
  if (
    match.is_grand_final &&
    match.is_reset_match
  ) {
    await env.DB.prepare(`
      UPDATE tournaments
      SET
        status = 'completed',
        champion_id = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        winnerId,
        now,
        tournamentId
      )
      .run();
  }
}


// ============================================================
// 找 Grand Final Reset
// ============================================================

async function findResetMatch(
  env,
  tournamentId,
  grandFinalId
) {
  return await env.DB.prepare(`
    SELECT *
    FROM tournament_matches
    WHERE tournament_id = ?
      AND is_grand_final = 1
      AND is_reset_match = 1
    ORDER BY id DESC
    LIMIT 1
  `)
    .bind(tournamentId)
    .first();
}


// ============================================================
// 取得完整賽事資料
// ============================================================

async function getTournamentDetail(
  env,
  tournamentId
) {
  const tournament =
    await env.DB.prepare(`
      SELECT
        t.id,
        t.name,
        t.format,
        t.size,
        t.status,
        t.champion_id,
        t.created_at,
        t.updated_at,
        c.name AS champion_name
      FROM tournaments t
      LEFT JOIN tournament_participants c
        ON c.id = t.champion_id
      WHERE t.id = ?
    `)
      .bind(tournamentId)
      .first();

  if (!tournament) {
    return null;
  }

  const participants =
    await env.DB.prepare(`
      SELECT
        id,
        name,
        seed
      FROM tournament_participants
      WHERE tournament_id = ?
      ORDER BY seed ASC
    `)
      .bind(tournamentId)
      .all();

  const matches =
    await env.DB.prepare(`
      SELECT
        m.id,
        m.bracket,
        m.round,
        m.position,

        m.participant1_id,
        m.participant2_id,

        p1.name AS participant1_name,
        p2.name AS participant2_name,

        m.score1,
        m.score2,
        m.winner_id,
        m.status,

        m.is_bye_match,
        m.is_grand_final,
        m.is_reset_match,

        m.next_match_id,
        m.next_match_slot,

        m.loser_next_match_id,
        m.loser_next_match_slot

      FROM tournament_matches m

      LEFT JOIN tournament_participants p1
        ON p1.id = m.participant1_id

      LEFT JOIN tournament_participants p2
        ON p2.id = m.participant2_id

      WHERE m.tournament_id = ?

      ORDER BY
        m.bracket ASC,
        m.round ASC,
        m.position ASC
    `)
      .bind(tournamentId)
      .all();

  return {
    tournament,
    participants:
      participants.results || [],
    matches:
      matches.results || []
  };
}


// ============================================================
// Fisher-Yates 洗牌
// ============================================================

function shuffle(array) {
  const result = [...array];

  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() * (i + 1)
      );

    [
      result[i],
      result[j]
    ] = [
      result[j],
      result[i]
    ];
  }

  return result;
}
