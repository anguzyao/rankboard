import { generateBracket } from "./bracket-engine.js";

export async function handleTournamentRoutes(
  request,
  env,
  url,
  requireAdmin,
  jsonResponse
) {
  const path = url.pathname;

  if (path === "/api/tournaments" && request.method === "GET") {
    const session = await requireAdmin(request, env);

    const where =
      session?.type === "device"
        ? "WHERE t.management_device_id = ?"
        : "";

    const statement = env.DB.prepare(`
      SELECT
        t.id,
        t.name,
        t.format,
        t.size,
        t.status,
        t.champion_id,
        t.created_at,
        t.updated_at,
        t.management_device_id,
        c.name AS champion_name
      FROM tournaments t
      LEFT JOIN tournament_participants c
        ON c.id = t.champion_id
      ${where}
      ORDER BY t.created_at DESC
    `);

    const rows =
      session?.type === "device"
        ? await statement.bind(session.deviceId).all()
        : await statement.all();

    return jsonResponse({
      tournaments: rows.results || []
    });
  }

  if (path === "/api/tournaments" && request.method === "POST") {
    const session = await requireAdmin(request, env);

    if (!session) {
      return jsonResponse(
        { error: "未登入管理員帳號" },
        401
      );
    }

    const body = await request.json().catch(
      () => ({})
    );

    const name =
      String(body.name || "").trim();

    const format =
      String(body.format || "");

    const randomize =
      Boolean(body.randomize);

    let names =
      Array.isArray(body.participants)
        ? body.participants
            .map((n) =>
              String(n || "").trim()
            )
            .filter(Boolean)
        : [];

    if (!name) {
      return jsonResponse(
        { error: "賽事名稱不能為空白" },
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
        { error: "賽制錯誤" },
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

    if (randomize) {
      names = shuffle(names);
    }

    const seedParticipants =
      names.map((n, i) => ({
        id: i + 1,
        name: n
      }));

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

    const tournamentInsert =
      await env.DB.prepare(`
        INSERT INTO tournaments (
          name,
          format,
          size,
          status,
          created_at,
          updated_at,
          management_device_id
        )
        VALUES (
          ?,
          ?,
          ?,
          'in_progress',
          ?,
          ?,
          ?
        )
      `).bind(
        name,
        format,
        names.length,
        now,
        now,
        session.type === "device"
          ? session.deviceId
          : null
      ).run();

    const tournamentId =
      tournamentInsert.meta.last_row_id;

    const seedToDbId =
      new Map();

    for (const p of seedParticipants) {
      const res =
        await env.DB.prepare(`
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

    const resolveParticipant =
      (p) =>
        p
          ? seedToDbId.get(p.id) || null
          : null;

    const tempIdToDbId =
      new Map();

    for (const m of generated.matches) {
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
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `).bind(
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

        tempIdToDbId.get(m.id)
      ).run();
    }

    /*
     * 新賽事重新建立 play_order。
     * BYE 不佔正式場次。
     */
    await env.DB.prepare(`
      UPDATE tournament_matches
      SET play_order = NULL
      WHERE tournament_id = ?
    `).bind(
      tournamentId
    ).run();

    /*
     * 找出第一輪已經確定的 BYE。
     */
    const initialByes =
      await env.DB.prepare(`
        SELECT
          id,
          winner_id,
          next_match_id,
          next_match_slot
        FROM tournament_matches
        WHERE tournament_id = ?
          AND is_bye_match = 1
          AND status = 'completed'
          AND winner_id IS NOT NULL
      `).bind(
        tournamentId
      ).all();

    const initialQueue =
      (initialByes.results || [])
        .filter(
          (match) =>
            match.next_match_id
        )
        .map((match) => ({
          matchId:
            match.next_match_id,
          slot:
            match.next_match_slot,
          participantId:
            match.winner_id
        }));

    if (initialQueue.length) {
      await propagate(
        env,
        tournamentId,
        initialQueue
      );
    } else {
      await refreshReadyMatches(
        env,
        tournamentId
      );
    }

    return jsonResponse({
      success: true,
      tournamentId
    });
  }

  /*
   * ==========================================================
   * 隨機重新排列第一輪正式比賽的「場次順序」
   * ==========================================================
   */

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
          format,
          status,
          management_device_id
        FROM tournaments
        WHERE id = ?
      `).bind(
        tournamentId
      ).first();

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
      session.type === "device" &&
      Number(tournament.management_device_id) !==
        Number(session.deviceId)
    ) {
      return jsonResponse(
        {
          error: "你沒有管理這個賽事的權限"
        },
        403
      );
    }

    if (
      tournament.status ===
      "completed"
    ) {
      return jsonResponse(
        {
          error:
            "賽事已完成，無法再隨機排列"
        },
        400
      );
    }

    /*
     * BYE 不算正式比賽開始。
     *
     * 只要有任何正式比賽完成，
     * 就代表賽事已經開始。
     */
    const started =
      await env.DB.prepare(`
        SELECT id
        FROM tournament_matches
        WHERE tournament_id = ?
          AND is_bye_match = 0
          AND status = 'completed'
        LIMIT 1
      `).bind(
        tournamentId
      ).first();

    if (started) {
      return jsonResponse(
        {
          error:
            "賽事已經開始比賽，無法再隨機排列"
        },
        400
      );
    }

    /*
     * 隨機的是第一輪正式比賽的「場次順序」。
     *
     * 不重新配對參賽者。
     * 不改變 bracket 結構。
     */
    const rows =
      await env.DB.prepare(`
        SELECT id
        FROM tournament_matches
        WHERE tournament_id = ?
          AND bracket = 'winners'
          AND round = 1
          AND is_bye_match = 0
          AND status != 'completed'
          AND status != 'void'
        ORDER BY id ASC
      `).bind(
        tournamentId
      ).all();

    const matchIds =
      shuffle(
        (rows.results || [])
          .map(
            (row) =>
              Number(row.id)
          )
      );

    if (!matchIds.length) {
      return jsonResponse({
        success: true,
        randomized: 0
      });
    }

    const statements = [
      env.DB.prepare(`
        UPDATE tournament_matches
        SET play_order = NULL
        WHERE tournament_id = ?
          AND bracket = 'winners'
          AND round = 1
          AND is_bye_match = 0
      `).bind(
        tournamentId
      )
    ];

    matchIds.forEach(
      (matchId, index) => {
        statements.push(
          env.DB.prepare(`
            UPDATE tournament_matches
            SET
              play_order = ?,
              updated_at = ?
            WHERE id = ?
              AND tournament_id = ?
          `).bind(
            index + 1,
            new Date().toISOString(),
            matchId,
            tournamentId
          )
        );
      }
    );

    await env.DB.batch(
      statements
    );

    return jsonResponse({
      success: true,
      randomized:
        matchIds.length
    });
  }

  /*
   * ==========================================================
   * 單一賽事
   * ==========================================================
   */

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

  /*
   * ==========================================================
   * 刪除賽事
   * ==========================================================
   */

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

    const tournament =
      await env.DB.prepare(`
        SELECT id, management_device_id
        FROM tournaments
        WHERE id = ?
      `).bind(tournamentId).first();

    if (!tournament) {
      return jsonResponse(
        { error: "找不到這個賽事" },
        404
      );
    }

    if (
      session.type === "device" &&
      Number(tournament.management_device_id) !==
        Number(session.deviceId)
    ) {
      return jsonResponse(
        { error: "你沒有管理這個賽事的權限" },
        403
      );
    }

    await env.DB.prepare(`
      DELETE FROM tournaments
      WHERE id = ?
    `).bind(
      tournamentId
    ).run();

    return jsonResponse({
      success: true
    });
  }

  /*
   * ==========================================================
   * 登錄比賽結果
   * ==========================================================
   */

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
      await request.json().catch(
        () => ({})
      );

    const winnerId =
      Number(
        body.winnerId
      );

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

    const tournament =
      await env.DB.prepare(`
        SELECT id, management_device_id, status
        FROM tournaments
        WHERE id = ?
      `).bind(tournamentId).first();

    if (!tournament) {
      return jsonResponse(
        { error: "找不到這個賽事" },
        404
      );
    }

    if (
      session.type === "device" &&
      Number(tournament.management_device_id) !==
        Number(session.deviceId)
    ) {
      return jsonResponse(
        { error: "你沒有管理這個賽事的權限" },
        403
      );
    }

    const match =
      await env.DB.prepare(`
        SELECT *
        FROM tournament_matches
        WHERE id = ?
          AND tournament_id = ?
      `).bind(
        matchId,
        tournamentId
      ).first();

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
      match.is_bye_match
    ) {
      return jsonResponse(
        {
          error:
            "BYE 比賽會自動晉級，不能手動登錄結果"
        },
        400
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

    /*
     * 核心規則：
     * 只有 ready 才可以登錄。
     */
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

    return jsonResponse({
      success: true
    });
  }

  return null;
}

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
  `).bind(
    winnerId,
    score1,
    score2,
    now,
    matchId,
    tournamentId
  ).run();

  const match =
    await env.DB.prepare(`
      SELECT *
      FROM tournament_matches
      WHERE id = ?
        AND tournament_id = ?
    `).bind(
      matchId,
      tournamentId
    ).first();

  if (!match) {
    return;
  }

  const queue = [];

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
    tournamentId,
    queue
  );
}

async function propagate(
  env,
  tournamentId,
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

    if (
      !matchId ||
      !participantId
    ) {
      continue;
    }

    const target =
      await env.DB.prepare(`
        SELECT *
        FROM tournament_matches
        WHERE id = ?
          AND tournament_id = ?
      `).bind(
        matchId,
        tournamentId
      ).first();

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

    const existingParticipant =
      slot === 1
        ? target.participant1_id
        : target.participant2_id;

    if (
      existingParticipant &&
      Number(
        existingParticipant
      ) !==
        Number(participantId)
    ) {
      continue;
    }

    if (!existingParticipant) {
      await env.DB.prepare(`
        UPDATE tournament_matches
        SET ${column} = ?,
            updated_at = ?
        WHERE id = ?
          AND tournament_id = ?
      `).bind(
        participantId,
        now,
        matchId,
        tournamentId
      ).run();
    }

    const p1 =
      slot === 1
        ? participantId
        : target.participant1_id;

    const p2 =
      slot === 2
        ? participantId
        : target.participant2_id;

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
            play_order = NULL,
            updated_at = ?
          WHERE id = ?
            AND tournament_id = ?
        `).bind(
          solo,
          now,
          matchId,
          tournamentId
        ).run();

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
  }

  await refreshReadyMatches(
    env,
    tournamentId
  );
}

async function refreshReadyMatches(
  env,
  tournamentId
) {
  const tournament =
    await env.DB.prepare(`
      SELECT format
      FROM tournaments
      WHERE id = ?
    `).bind(
      tournamentId
    ).first();

  if (!tournament) {
    return;
  }

  const rows =
    await env.DB.prepare(`
      SELECT *
      FROM tournament_matches
      WHERE tournament_id = ?
      ORDER BY
        bracket ASC,
        round ASC,
        position ASC,
        id ASC
    `).bind(
      tournamentId
    ).all();

  const matches =
    rows.results || [];

  const now =
    new Date().toISOString();

  const cleanupStatements =
    [];

  for (const match of matches) {
    if (
      Number(
        match.is_bye_match
      ) === 1 ||
      match.status === "void"
    ) {
      if (
        match.play_order !== null
      ) {
        cleanupStatements.push(
          env.DB.prepare(`
            UPDATE tournament_matches
            SET
              play_order = NULL,
              updated_at = ?
            WHERE id = ?
          `).bind(
            now,
            match.id
          )
        );
      }
    }
  }

  if (
    cleanupStatements.length
  ) {
    await env.DB.batch(
      cleanupStatements
    );
  }

  if (
    tournament.format ===
    "single_elimination"
  ) {
    await refreshSingleElimination(
      env,
      tournamentId,
      matches
    );
    return;
  }

  await refreshDoubleElimination(
    env,
    tournamentId,
    matches
  );
}

async function refreshSingleElimination(
  env,
  tournamentId,
  matches
) {
  const winners =
    matches
      .filter(
        (match) =>
          match.bracket ===
            "winners" &&
          Number(
            match.is_bye_match
          ) !== 1 &&
          match.status !==
            "void"
      )
      .sort(
        (a, b) =>
          Number(a.round) -
            Number(b.round) ||
          Number(a.position) -
            Number(b.position) ||
          Number(a.id) -
            Number(b.id)
      );

  const now =
    new Date().toISOString();

  const updates = [];

  const rounds = [
    ...new Set(
      winners.map(
        (match) =>
          Number(match.round)
      )
    )
  ].sort(
    (a, b) => a - b
  );

  const roundComplete =
    new Map();

  for (const round of rounds) {
    const roundMatches =
      winners.filter(
        (match) =>
          Number(match.round) ===
          round
      );

    const complete =
      roundMatches.length > 0 &&
      roundMatches.every(
        (match) =>
          match.status ===
            "completed" ||
          match.status ===
            "void"
      );

    roundComplete.set(
      round,
      complete
    );
  }

  for (const match of winners) {
    if (
      match.status ===
      "completed"
    ) {
      continue;
    }

    const round =
      Number(match.round);

    let shouldBeReady =
      Boolean(
        match.participant1_id &&
        match.participant2_id
      );

    if (round > 1) {
      shouldBeReady =
        shouldBeReady &&
        roundComplete.get(
          round - 1
        ) === true;
    }

    const nextStatus =
      shouldBeReady
        ? "ready"
        : "pending";

    if (
      match.status !==
      nextStatus
    ) {
      updates.push(
        env.DB.prepare(`
          UPDATE tournament_matches
          SET
            status = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
          nextStatus,
          now,
          match.id
        )
      );
    }
  }

  if (updates.length) {
    await env.DB.batch(
      updates
    );
  }

  const latest =
    await env.DB.prepare(`
      SELECT
        id,
        round,
        position,
        status,
        play_order,
        is_bye_match
      FROM tournament_matches
      WHERE tournament_id = ?
        AND bracket = 'winners'
        AND status != 'void'
        AND is_bye_match = 0
    `).bind(
      tournamentId
    ).all();

  const latestMatches =
    latest.results || [];

  const playable =
    latestMatches
      .filter(
        (match) =>
          match.status ===
            "completed" ||
          match.status ===
            "ready"
      )
      .sort(
        (a, b) => {
          const aOrder =
            a.play_order === null ||
            a.play_order === undefined
              ? Number.MAX_SAFE_INTEGER
              : Number(
                  a.play_order
                );

          const bOrder =
            b.play_order === null ||
            b.play_order === undefined
              ? Number.MAX_SAFE_INTEGER
              : Number(
                  b.play_order
                );

          return (
            aOrder - bOrder ||
            Number(a.round) -
              Number(b.round) ||
            Number(a.position) -
              Number(b.position) ||
            Number(a.id) -
              Number(b.id)
          );
        }
      );

  const normalizeStatements =
    [];

  playable.forEach(
    (match, index) => {
      const order =
        index + 1;

      if (
        Number(
          match.play_order
        ) !== order
      ) {
        normalizeStatements.push(
          env.DB.prepare(`
            UPDATE tournament_matches
            SET
              play_order = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
            order,
            new Date().toISOString(),
            match.id
          )
        );
      }
    }
  );

  const pendingMatches =
    latestMatches.filter(
      (match) =>
        match.status ===
          "pending" &&
        match.play_order !==
          null
    );

  for (
    const match of pendingMatches
  ) {
    normalizeStatements.push(
      env.DB.prepare(`
        UPDATE tournament_matches
        SET
          play_order = NULL,
          updated_at = ?
        WHERE id = ?
      `).bind(
        new Date().toISOString(),
        match.id
      )
    );
  }

  if (
    normalizeStatements.length
  ) {
    await env.DB.batch(
      normalizeStatements
    );
  }
}

async function refreshDoubleElimination(
  env,
  tournamentId,
  matches
) {
  const active =
    matches
      .filter(
        (match) =>
          Number(
            match.is_bye_match
          ) !== 1 &&
          match.status !==
            "completed" &&
          match.status !==
            "void"
      )
      .sort(
        (a, b) =>
          Number(a.round) -
            Number(b.round) ||
          Number(a.position) -
            Number(b.position) ||
          Number(a.id) -
            Number(b.id)
      );

  const now =
    new Date().toISOString();

  const updates = [];

  let maxPlayOrder =
    0;

  for (const match of matches) {
    if (
      Number(
        match.is_bye_match
      ) !== 1 &&
      match.status !==
        "void" &&
      match.play_order !==
        null
    ) {
      maxPlayOrder =
        Math.max(
          maxPlayOrder,
          Number(
            match.play_order
          )
        );
    }
  }

  for (const match of active) {
    const shouldBeReady =
      Boolean(
        match.participant1_id &&
        match.participant2_id
      );

    const nextStatus =
      shouldBeReady
        ? "ready"
        : "pending";

    if (
      match.status !==
      nextStatus
    ) {
      updates.push(
        env.DB.prepare(`
          UPDATE tournament_matches
          SET
            status = ?,
            updated_at = ?
          WHERE id = ?
        `).bind(
          nextStatus,
          now,
          match.id
        )
      );
    }

    if (
      shouldBeReady
    ) {
      if (
        match.play_order ===
          null ||
        match.play_order ===
          undefined
      ) {
        maxPlayOrder += 1;

        updates.push(
          env.DB.prepare(`
            UPDATE tournament_matches
            SET
              play_order = ?,
              updated_at = ?
            WHERE id = ?
          `).bind(
            maxPlayOrder,
            now,
            match.id
          )
        );
      }
    } else if (
      match.play_order !==
      null
    ) {
      updates.push(
        env.DB.prepare(`
          UPDATE tournament_matches
          SET
            play_order = NULL,
            updated_at = ?
          WHERE id = ?
        `).bind(
          now,
          match.id
        )
      );
    }
  }

  if (updates.length) {
    await env.DB.batch(
      updates
    );
  }
}

async function handleSpecialMatchCompletion(
  env,
  tournamentId,
  match,
  winnerId
) {
  const now =
    new Date().toISOString();

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
      `).bind(
        tournamentId
      ).first();

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
      `).bind(
        winnerId,
        now,
        tournamentId
      ).run();
    }

    return;
  }

  if (
    match.is_grand_final &&
    !match.is_reset_match
  ) {
    if (
      winnerId ===
      match.participant1_id
    ) {
      await env.DB.prepare(`
        UPDATE tournaments
        SET
          status = 'completed',
          champion_id = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        winnerId,
        now,
        tournamentId
      ).run();

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
            play_order = NULL,
            updated_at = ?
          WHERE id = ?
        `).bind(
          now,
          reset.id
        ).run();
      }
    } else {
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
        `).bind(
          match.participant1_id,
          match.participant2_id,
          now,
          reset.id
        ).run();

        await refreshReadyMatches(
          env,
          tournamentId
        );
      }
    }

    return;
  }

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
    `).bind(
      winnerId,
      now,
      tournamentId
    ).run();
  }
}

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
  `).bind(
    tournamentId
  ).first();
}

async function getTournamentDetail(
  env,
  tournamentId
) {
  await refreshReadyMatches(
    env,
    tournamentId
  );

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
        t.management_device_id,
        c.name AS champion_name
      FROM tournaments t
      LEFT JOIN tournament_participants c
        ON c.id = t.champion_id
      WHERE t.id = ?
    `).bind(
      tournamentId
    ).first();

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
    `).bind(
      tournamentId
    ).all();

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
        m.play_order,
        m.next_match_id,
        m.next_match_slot,
        m.loser_next_match_id,
        m.loser_next_match_slot
      FROM tournament_matches m
      LEFT JOIN tournament_participants p1
        ON p1.id =
          m.participant1_id
      LEFT JOIN tournament_participants p2
        ON p2.id =
          m.participant2_id
      WHERE m.tournament_id = ?
      ORDER BY
        m.bracket ASC,
        m.round ASC,
        m.position ASC
    `).bind(
      tournamentId
    ).all();

  return {
    tournament,
    participants:
      participants.results || [],
    matches:
      matches.results || []
  };
}

function shuffle(array) {
  const result =
    [...array];

  for (
    let i = result.length - 1;
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
