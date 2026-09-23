// ============================================================
// tournaments.js
//
// 賽程安排器的 API。跟排行榜(index.js)完全獨立,
// 不會互相影響 — 排行榜可以照常運作,賽程功能也可以單獨使用。
//
// 路由:
//   GET    /api/tournaments
//   POST   /api/tournaments
//   GET    /api/tournaments/:id
//   DELETE /api/tournaments/:id
//   PATCH  /api/tournaments/:id/matches/:matchId
//   POST   /api/tournaments/:id/randomize
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

  // ============================================================
  // 列表
  // ============================================================
  if (
    path === "/api/tournaments" &&
    request.method === "GET"
  ) {
    const rows = await env.DB.prepare(`
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
      ORDER BY t.created_at DESC
    `).all();

    return jsonResponse({
      tournaments: rows.results || []
    });
  }

  // ============================================================
  // 建立新賽事
  // ============================================================
  if (
    path === "/api/tournaments" &&
    request.method === "POST"
  ) {
    const session = await requireAdmin(
      request,
      env
    );

    if (!session) {
      return jsonResponse(
        {
          error: "未登入管理員帳號"
        },
        401
      );
    }

    const body =
      await request
        .json()
        .catch(() => ({}));

    const name =
      String(
        body.name || ""
      ).trim();

    const format =
      String(
        body.format || ""
      );

    const randomize =
      Boolean(
        body.randomize
      );

    let names =
      Array.isArray(
        body.participants
      )
        ? body.participants
            .map((n) =>
              String(
                n || ""
              ).trim()
            )
            .filter(Boolean)
        : [];

    if (!name) {
      return jsonResponse(
        {
          error:
            "賽事名稱不能為空白"
        },
        400
      );
    }

    if (
      ![
        "single_elimination",
        "double_elimination"
      ].includes(format)
    ) {
      return jsonResponse(
        {
          error: "賽制錯誤"
        },
        400
      );
    }

    if (
      names.length < 2 ||
      names.length > 48
    ) {
      return jsonResponse(
        {
          error:
            "參賽人數需介於 2 到 48 人"
        },
        400
      );
    }

    // 建立賽事時如果勾選 randomize,
    // 仍然沿用原本的參賽者洗牌功能。
    if (randomize) {
      names = shuffle(names);
    }

    const seedParticipants =
      names.map(
        (n, i) => ({
          id: i + 1,
          name: n
        })
      );

    let generated;

    try {
      generated =
        generateBracket(
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

    const now =
      new Date().toISOString();

    // ============================================================
    // 建立賽事
    // ============================================================
    const tournamentInsert =
      await env.DB.prepare(`
        INSERT INTO tournaments (
          name,
          format,
          size,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'in_progress', ?, ?)
      `)
        .bind(
          name,
          format,
          names.length,
          now,
          now
        )
        .run();

    const tournamentId =
      tournamentInsert
        .meta
        .last_row_id;

    // ============================================================
    // 建立參賽者
    // ============================================================
    const seedToDbId =
      new Map();

    for (
      const p of seedParticipants
    ) {
      const res =
        await env.DB.prepare(`
          INSERT INTO tournament_participants (
            tournament_id,
            name,
            seed,
            created_at
          )
          VALUES (?, ?, ?, ?)
        `)
          .bind(
            tournamentId,
            p.name,
            p.id,
            now
          )
          .run();

      seedToDbId.set(
        p.id,
        res.meta.last_row_id
      );
    }

    const resolveParticipant =
      (p) =>
        p
          ? seedToDbId.get(
              p.id
            ) || null
          : null;

    // ============================================================
    // Phase A
    //
    // 先建立所有比賽。
    // 這時候 next_match_id 還不能寫,
    // 因為 DB id 尚未全部產生。
    //
    // play_order 故意先保持 NULL。
    // 後面由 refreshReadyMatches()
    // 按照真正可以開始的場次分配。
    // ============================================================
    const tempIdToDbId =
      new Map();

    for (
      const m of generated.matches
    ) {
      const status =
        m.status ||
        (
          m.void
            ? "void"
            : "pending"
        );

      const res =
        await env.DB.prepare(`
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
        `)
          .bind(
            tournamentId,
            m.bracket,
            m.round,
            m.position,
            resolveParticipant(
              m.participant1
            ),
            resolveParticipant(
              m.participant2
            ),
            resolveParticipant(
              m.winner
            ),
            status,
            m.isByeMatch
              ? 1
              : 0,
            m.isGrandFinal
              ? 1
              : 0,
            m.isResetMatch
              ? 1
              : 0,
            now,
            now
          )
          .run();

      tempIdToDbId.set(
        m.id,
        res.meta.last_row_id
      );
    }

    // ============================================================
    // Phase B
    //
    // 補上比賽之間的連線關係
    // ============================================================
    for (
      const m of generated.matches
    ) {
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
      `)
        .bind(
          m.nextMatchId
            ? tempIdToDbId.get(
                m.nextMatchId
              )
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

          tempIdToDbId.get(
            m.id
          )
        )
        .run();
    }

    // ============================================================
    // Phase C
    //
    // 處理建立賽程時就已經完成的第一輪 Bye。
    //
    // Bye 本身不算正式比賽,
    // 但 Bye 勝者必須繼續往下一場傳遞。
    // ============================================================
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

    const initialByeQueue =
      (
        initialByeRows.results ||
        []
      ).map(
        (row) => ({
          matchId:
            row.next_match_id,
          slot:
            row.next_match_slot,
          participantId:
            row.winner_id
        })
      );

    if (
      initialByeQueue.length >
      0
    ) {
      await propagate(
        env,
        tournamentId,
        initialByeQueue
      );
    }

    // ============================================================
    // 建立完成後一定重新整理一次 ready 狀態。
    //
    // 這裡不能只放在 initialByeQueue 裡面,
    // 因為 4、8、16、32、48 等情況可能沒有 Bye Queue。
    // ============================================================
    await refreshReadyMatches(
      env,
      tournamentId
    );

    return jsonResponse({
      success: true,
      tournamentId
    });
  }

  // ============================================================
  // 隨機排列比賽順序
  //
  // 規則:
  // 1. 只能管理員操作
  // 2. 賽事完成後不能操作
  // 3. 只要正式比賽已有 completed,
  //    就視為已經開始,不能再隨機
  // 4. BYE 不算開始比賽
  // 5. 可以在正式開賽前重複執行
  // 6. 只重新排列第一輪「正式比賽」
  // ============================================================
  const randomizeMatch =
    path.match(
      /^\/api\/tournaments\/(\d+)\/randomize$/
    );

  if (
    randomizeMatch &&
    request.method === "POST"
  ) {
    const session =
      await requireAdmin(
        request,
        env
      );

    if (!session) {
      return jsonResponse(
        {
          error:
            "未登入管理員帳號"
        },
        401
      );
    }

    const tournamentId =
      Number(
        randomizeMatch[1]
      );

    const tournament =
      await env.DB.prepare(`
        SELECT
          id,
          name,
          format,
          size,
          status
        FROM tournaments
        WHERE id = ?
      `)
        .bind(tournamentId)
        .first();

    if (!tournament) {
      return jsonResponse(
        {
          error:
            "找不到這個賽事"
        },
        404
      );
    }

    if (
      tournament.status ===
      "completed"
    ) {
      return jsonResponse(
        {
          error:
            "賽事已經完成，無法再隨機排列"
        },
        400
      );
    }

    // ============================================================
    // 正式比賽只要有一場 completed,
    // 就代表賽事已經開始。
    //
    // BYE excluded.
    // ============================================================
    const started =
      await env.DB.prepare(`
        SELECT id
        FROM tournament_matches
        WHERE tournament_id = ?
          AND is_bye_match = 0
          AND status = 'completed'
        LIMIT 1
      `)
        .bind(tournamentId)
        .first();

    if (started) {
      return jsonResponse(
        {
          error:
            "賽事已經開始比賽，無法再隨機排列"
        },
        400
      );
    }

    // ============================================================
    // 只抓第一輪正式比賽。
    // BYE 不參與隨機場次。
    // ============================================================
    const firstRound =
      await env.DB.prepare(`
        SELECT
          id
        FROM tournament_matches
        WHERE tournament_id = ?
          AND bracket = 'winners'
          AND round = 1
          AND is_bye_match = 0
          AND status != 'completed'
          AND status != 'void'
        ORDER BY
          position ASC,
          id ASC
      `)
        .bind(tournamentId)
        .all();

    const matchIds =
      shuffle(
        (
          firstRound.results ||
          []
        ).map(
          (row) => row.id
        )
      );

    // ============================================================
    // 重新分配場次 1、2、3、4...
    // ============================================================
    for (
      let i = 0;
      i < matchIds.length;
      i++
    ) {
      await env.DB.prepare(`
        UPDATE tournament_matches
        SET
          play_order = ?,
          updated_at = ?
        WHERE id = ?
          AND tournament_id = ?
      `)
        .bind(
          i + 1,
          new Date().toISOString(),
          matchIds[i],
          tournamentId
        )
        .run();
    }

    return jsonResponse({
      success: true,
      message:
        "第一輪比賽順序已重新隨機排列",
      count: matchIds.length
    });
  }

  // ============================================================
  // 單一賽事詳細資料
  // ============================================================
  const detailMatch =
    path.match(
      /^\/api\/tournaments\/(\d+)$/
    );

  if (
    detailMatch &&
    request.method === "GET"
  ) {
    const tournamentId =
      Number(
        detailMatch[1]
      );

    const detail =
      await getTournamentDetail(
        env,
        tournamentId
      );

    if (!detail) {
      return jsonResponse(
        {
          error:
            "找不到這個賽事"
        },
        404
      );
    }

    return jsonResponse(
      detail
    );
  }

  // ============================================================
  // 刪除賽事
  // ============================================================
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
        {
          error:
            "未登入管理員帳號"
        },
        401
      );
    }

    const tournamentId =
      Number(
        detailMatch[1]
      );

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

  // ============================================================
  // 登錄比賽結果
  // ============================================================
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
        {
          error:
            "未登入管理員帳號"
        },
        401
      );
    }

    const tournamentId =
      Number(
        matchResultMatch[1]
      );

    const matchId =
      Number(
        matchResultMatch[2]
      );

    const body =
      await request
        .json()
        .catch(
          () => ({})
        );

    const winnerId =
      Number(
        body.winnerId
      );

    const score1 =
      body.score1 ===
        undefined ||
      body.score1 === null
        ? null
        : Number(
            body.score1
          );

    const score2 =
      body.score2 ===
        undefined ||
      body.score2 === null
        ? null
        : Number(
            body.score2
          );

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
        {
          error:
            "找不到這場比賽"
        },
        404
      );
    }

    if (
      match.status ===
      "completed"
    ) {
      return jsonResponse(
        {
          error:
            "這場比賽已經有結果了"
        },
        400
      );
    }

    // ============================================================
    // 防止管理員直接跳過比賽順序。
    //
    // 只有 ready 才能正式登錄結果。
    // pending / void / 其他狀態都不允許。
    // ============================================================
    if (
      match.status !==
      "ready"
    ) {
      return jsonResponse(
        {
          error:
            "這場比賽目前尚未開放，請依照比賽順序進行"
        },
        400
      );
    }

    if (
      !match.participant1_id ||
      !match.participant2_id ||
      (
        winnerId !==
          match.participant1_id &&
        winnerId !==
          match.participant2_id
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
      winnerId ===
      match.participant1_id
        ? match.participant2_id
        : match.participant1_id;

    await completeMatch(
      env,
      tournamentId,
      {
        matchId,
        winnerId,
        loserId,
        score1,
        score2
      }
    );

    await handleSpecialMatchCompletion(
      env,
      tournamentId,
      match,
      winnerId
    );

    // ============================================================
    // 特殊賽事處理後再整理一次 ready。
    //
    // 對單淘汰不會破壞既有狀態。
    // 對雙敗 Grand Final / Reset 則可確保
    // 新產生的正式場次取得 play_order。
    // ============================================================
    await refreshReadyMatches(
      env,
      tournamentId
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
  tournamentId,
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
      AND tournament_id = ?
  `)
    .bind(
      winnerId,
      score1,
      score2,
      now,
      matchId,
      tournamentId
    )
    .run();

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

  const queue = [];

  // ============================================================
  // 勝者 → 勝部下一場
  // ============================================================
  if (
    match &&
    match.next_match_id
  ) {
    queue.push({
      matchId:
        match.next_match_id,
      slot:
        match.next_match_slot,
      participantId:
        winnerId
    });
  }

  // ============================================================
  // 敗者 → 敗部下一場
  // ============================================================
  if (
    match &&
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
    tournamentId,
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
//
// 注意:
// 這裡不直接決定正式比賽 ready。
// 所有 ready 狀態統一交給 refreshReadyMatches()。
// 這樣單淘汰才能確保:
// 第一輪全部完成 → 第二輪
// 第二輪全部完成 → 第三輪
// ============================================================

async function propagate(
  env,
  tournamentId,
  queue
) {
  const now =
    new Date().toISOString();

  while (
    queue.length > 0
  ) {
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
          AND tournament_id = ?
      `)
        .bind(
          matchId,
          tournamentId
        )
        .first();

    if (
      !target ||
      target.status ===
        "completed" ||
      target.status ===
        "void"
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
        AND tournament_id = ?
    `)
      .bind(
        participantId,
        now,
        matchId,
        tournamentId
      )
      .run();

    const p1 =
      column ===
      "participant1_id"
        ? participantId
        : target.participant1_id;

    const p2 =
      column ===
      "participant2_id"
        ? participantId
        : target.participant2_id;

    // ============================================================
    // Bye
    // ============================================================
    if (
      target.is_bye_match
    ) {
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
            AND tournament_id = ?
        `)
          .bind(
            solo,
            now,
            matchId,
            tournamentId
          )
          .run();

        // Bye 勝者繼續往下一場
        if (
          target.next_match_id
        ) {
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

    // ============================================================
    // 正式比賽
    //
    // 不在這裡直接 ready。
    // 等 queue 全部處理完之後,
    // 由 refreshReadyMatches() 統一判斷。
    // ============================================================
  }

  await refreshReadyMatches(
    env,
    tournamentId
  );
}

// ============================================================
// 整理「可以開始的比賽」
//
// 單淘汰規則:
//
// Round 1:
//   只要兩位選手都到位 → ready
//
// Round 2:
//   Round 1 所有場次必須 completed / void
//   才能讓 Round 2 ready
//
// Round 3:
//   Round 2 所有場次必須 completed / void
//   才能讓 Round 3 ready
//
// 依此類推。
//
// Bye:
//   completed 不算正式比賽,
//   但會被視為該輪已經完成。
// ============================================================

async function refreshReadyMatches(
  env,
  tournamentId
) {
  const tournament =
    await env.DB.prepare(`
      SELECT
        id,
        format,
        status
      FROM tournaments
      WHERE id = ?
    `)
      .bind(tournamentId)
      .first();

  if (!tournament) {
    return;
  }

  const rows =
    await env.DB.prepare(`
      SELECT
        *
      FROM tournament_matches
      WHERE tournament_id = ?
        AND bracket = 'winners'
      ORDER BY
        round ASC,
        position ASC,
        id ASC
    `)
      .bind(tournamentId)
      .all();

  const matches =
    rows.results || [];

  if (!matches.length) {
    return;
  }

  // ============================================================
  // 找目前最大的 play_order。
  //
  // play_order 只給正式可以進行的比賽。
  // Bye 不需要佔用場次號碼。
  // ============================================================
  let maxPlayOrder = 0;

  for (
    const match of matches
  ) {
    if (
      match.is_bye_match
    ) {
      continue;
    }

    if (
      match.play_order !==
        null &&
      match.play_order !==
        undefined
    ) {
      const value =
        Number(
          match.play_order
        );

      if (
        Number.isFinite(
          value
        ) &&
        value > maxPlayOrder
      ) {
        maxPlayOrder =
          value;
      }
    }
  }

  let nextPlayOrder =
    maxPlayOrder + 1;

  // ============================================================
  // 單淘汰
  // ============================================================
  if (
    tournament.format ===
    "single_elimination"
  ) {
    const rounds =
      [
        ...new Set(
          matches.map(
            (m) =>
              Number(
                m.round
              )
          )
        )
      ].sort(
        (a, b) =>
          a - b
      );

    for (
      const round of rounds
    ) {
      const roundMatches =
        matches.filter(
          (m) =>
            Number(
              m.round
            ) === round
        );

      // ==========================================================
      // Round 1 永遠可以依照參賽者是否到位判斷。
      //
      // Round 2 之後:
      // 前一輪所有比賽必須 completed / void。
      // ==========================================================
      let previousRoundFinished =
        true;

      if (
        round >
        rounds[0]
      ) {
        const previousRound =
          round - 1;

        const previousMatches =
          matches.filter(
            (m) =>
              Number(
                m.round
              ) ===
              previousRound
          );

        previousRoundFinished =
          previousMatches.length >
            0 &&
          previousMatches.every(
            (m) =>
              m.status ===
                "completed" ||
              m.status ===
                "void"
          );
      }

      for (
        const match of roundMatches
      ) {
        // Bye 不需要再判斷 ready。
        if (
          match.is_bye_match
        ) {
          continue;
        }

        // 已經完成的正式比賽不能被重新開啟。
        if (
          match.status ===
          "completed"
        ) {
          continue;
        }

        // void 也不處理。
        if (
          match.status ===
          "void"
        ) {
          continue;
        }

        const hasBothPlayers =
          Boolean(
            match.participant1_id
          ) &&
          Boolean(
            match.participant2_id
          );

        // ========================================================
        // 前一輪尚未全部完成:
        // 強制維持 pending。
        // ========================================================
        if (
          !previousRoundFinished
        ) {
          if (
            match.status !==
            "pending"
          ) {
            await env.DB.prepare(`
              UPDATE tournament_matches
              SET
                status = 'pending',
                updated_at = ?
              WHERE id = ?
                AND tournament_id = ?
            `)
              .bind(
                new Date().toISOString(),
                match.id,
                tournamentId
              )
              .run();
          }

          continue;
        }

        // ========================================================
        // 前一輪完成 + 雙方都到位 → ready
        // ========================================================
        if (
          hasBothPlayers
        ) {
          if (
            match.status !==
            "ready"
          ) {
            await env.DB.prepare(`
              UPDATE tournament_matches
              SET
                status = 'ready',
                updated_at = ?
              WHERE id = ?
                AND tournament_id = ?
            `)
              .bind(
                new Date().toISOString(),
                match.id,
                tournamentId
              )
              .run();

            match.status =
              "ready";
          }

          // ======================================================
          // 尚未有場次編號,
          // 才分配新的 play_order。
          //
          // 這可以避免 refresh 時一直重新編號。
          // ======================================================
          if (
            match.play_order ===
              null ||
            match.play_order ===
              undefined
          ) {
            await env.DB.prepare(`
              UPDATE tournament_matches
              SET
                play_order = ?,
                updated_at = ?
              WHERE id = ?
                AND tournament_id = ?
            `)
              .bind(
                nextPlayOrder,
                new Date().toISOString(),
                match.id,
                tournamentId
              )
              .run();

            match.play_order =
              nextPlayOrder;

            nextPlayOrder++;
          }
        } else {
          // ======================================================
          // 人還沒到齊 → pending
          // ======================================================
          if (
            match.status !==
            "pending"
          ) {
            await env.DB.prepare(`
              UPDATE tournament_matches
              SET
                status = 'pending',
                updated_at = ?
              WHERE id = ?
                AND tournament_id = ?
            `)
              .bind(
                new Date().toISOString(),
                match.id,
                tournamentId
              )
              .run();

            match.status =
              "pending";
          }
        }
      }
    }

    return;
  }

  // ============================================================
  // 雙敗
  //
  // 雙敗暫時維持原本邏輯:
  // 雙方都到位即可 ready。
  //
  // 這裡不套用單淘汰的「整輪完成後才下一輪」限制,
  // 避免破壞既有 losers bracket 流程。
  // ============================================================
  if (
    tournament.format ===
    "double_elimination"
  ) {
    const now =
      new Date().toISOString();

    for (
      const match of matches
    ) {
      if (
        match.is_bye_match ||
        match.status ===
          "completed" ||
        match.status ===
          "void"
      ) {
        continue;
      }

      if (
        match.participant1_id &&
        match.participant2_id
      ) {
        if (
          match.status !==
          "ready"
        ) {
          await env.DB.prepare(`
            UPDATE tournament_matches
            SET
              status = 'ready',
              updated_at = ?
            WHERE id = ?
              AND tournament_id = ?
          `)
            .bind(
              now,
              match.id,
              tournamentId
            )
            .run();

          match.status =
            "ready";
        }

        if (
          match.play_order ===
            null ||
          match.play_order ===
            undefined
        ) {
          await env.DB.prepare(`
            UPDATE tournament_matches
            SET
              play_order = ?,
              updated_at = ?
            WHERE id = ?
              AND tournament_id = ?
          `)
            .bind(
              nextPlayOrder,
              now,
              match.id,
              tournamentId
            )
            .run();

          match.play_order =
            nextPlayOrder;

          nextPlayOrder++;
        }
      }
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

  // ============================================================
  // 單淘汰
  // ============================================================
  if (
    match.bracket ===
      "winners" &&
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

  // ============================================================
  // 雙敗 Grand Final
  // ============================================================
  if (
    match.is_grand_final &&
    !match.is_reset_match
  ) {
    if (
      winnerId ===
      match.participant1_id
    ) {
      // ========================================================
      // 勝部側獲勝
      // → 直接完成賽事
      // ========================================================
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
      // ========================================================
      // 敗部側獲勝
      // → 啟動 Reset
      // ========================================================
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

  // ============================================================
  // 雙敗 Reset
  // ============================================================
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
    .bind(
      tournamentId
    )
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
        m.play_order,

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
      participants.results ||
      [],
    matches:
      matches.results ||
      []
  };
}

// ============================================================
// Fisher-Yates 洗牌
// ============================================================

function shuffle(array) {
  const result =
    [...array];

  for (
    let i =
      result.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
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
