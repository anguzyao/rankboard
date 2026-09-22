const SESSION_COOKIE = "admin_session";
const SESSION_MINUTES = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // 公開排名
    // =========================
    if (url.pathname === "/api/state" && request.method === "GET") {
      const participants = await getParticipants(env);
      const ranking = buildRanking(participants);

      const historyRows = await env.DB
        .prepare(`
          SELECT participant_id, rank, created_at
          FROM ranking_history
          ORDER BY id DESC
        `)
        .all();

      const snapshots = [];

      for (const row of historyRows.results || []) {
        if (!snapshots.includes(row.created_at)) {
          snapshots.push(row.created_at);
        }

        if (snapshots.length >= 2) {
          break;
        }
      }

      const latestSnapshot = snapshots[0] || null;
      const previousSnapshot = snapshots[1] || null;

      const latestRanks = {};
      const previousRanks = {};

      for (const row of historyRows.results || []) {
        if (row.created_at === latestSnapshot) {
          latestRanks[row.participant_id] = row.rank;
        }

        if (row.created_at === previousSnapshot) {
          previousRanks[row.participant_id] = row.rank;
        }
      }

      const result = ranking.map((participant) => {
        const currentRank = participant.rank;

        let previousRank = null;

        if (previousSnapshot) {
          previousRank = previousRanks[participant.id] ?? null;
        } else {
          previousRank = null;
        }

        return {
          ...participant,
          previousRank
        };
      });

      const updatedAt = participants.length
        ? participants.reduce((latest, participant) => {
            return participant.updated_at > latest
              ? participant.updated_at
              : latest;
          }, participants[0].updated_at)
        : null;

      return jsonResponse({
        participants: result,
        updatedAt
      });
    }

    // =========================
    // 管理員登入
    // =========================
    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = await request.json();
      const password = String(body.password || "");

      if (
        password.trim() !==
        String(env.ADMIN_PASSWORD || "").trim()
      ) {
        return jsonResponse(
          { error: "密碼錯誤" },
          401
        );
      }

      const token = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + SESSION_MINUTES * 60 * 1000
      );

      await env.DB
        .prepare(`
          INSERT INTO sessions (
            token,
            expires_at,
            created_at
          )
          VALUES (?, ?, ?)
        `)
        .bind(
          token,
          expiresAt.toISOString(),
          now.toISOString()
        )
        .run();

      const response = jsonResponse({
        success: true
      });

      response.headers.set(
        "Set-Cookie",
        `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MINUTES * 60}`
      );

      return response;
    }

    // =========================
    // 管理員登出
    // =========================
    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(
        request,
        SESSION_COOKIE
      );

      if (token) {
        await env.DB
          .prepare(`
            DELETE FROM sessions
            WHERE token = ?
          `)
          .bind(token)
          .run();
      }

      const response = jsonResponse({
        success: true
      });

      response.headers.set(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      );

      return response;
    }

    // =========================
    // 登入狀態
    // =========================
    if (url.pathname === "/api/me" && request.method === "GET") {
      const session = await getSession(request, env);

      if (!session) {
        return jsonResponse(
          { authenticated: false },
          401
        );
      }

      await refreshSession(session.token, env);

      return jsonResponse({
        authenticated: true
      });
    }

    // =========================
    // 新增參賽者
    // =========================
    if (
      url.pathname === "/api/participants" &&
      request.method === "POST"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const body = await request.json();
      const name = String(body.name || "").trim();

      if (!name) {
        return jsonResponse(
          { error: "請輸入參賽者姓名" },
          400
        );
      }

      if (name.length > 50) {
        return jsonResponse(
          { error: "參賽者姓名最多 50 個字" },
          400
        );
      }

      const existing = await env.DB
        .prepare(`
          SELECT id
          FROM participants
          WHERE name = ?
          LIMIT 1
        `)
        .bind(name)
        .first();

      if (existing) {
        return jsonResponse(
          { error: "參賽者已存在" },
          409
        );
      }

      const now = await getNextTimestamp(env);

      const insertResult = await env.DB
        .prepare(`
          INSERT INTO participants (
            name,
            score,
            created_at,
            updated_at
          )
          VALUES (?, 0, ?, ?)
        `)
        .bind(
          name,
          now,
          now
        )
        .run();

      const participantId =
        insertResult.meta.last_row_id;

      await env.DB
        .prepare(`
          INSERT INTO operation_logs (
            action,
            participant_id,
            old_score,
            new_score,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          "CREATE_PARTICIPANT",
          participantId,
          null,
          0,
          now
        )
        .run();

      await createRankingSnapshot(
        env,
        now
      );

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true
      });
    }

    // =========================
    // 修改參賽者姓名
    // =========================
    if (
      url.pathname.match(/^\/api\/participants\/\d+$/) &&
      request.method === "PATCH"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const participantId = Number(
        url.pathname.split("/").pop()
      );

      const body = await request.json();
      const name = String(body.name || "").trim();

      if (!name) {
        return jsonResponse(
          { error: "姓名不能為空白" },
          400
        );
      }

      const participant = await env.DB
        .prepare(`
          SELECT *
          FROM participants
          WHERE id = ?
        `)
        .bind(participantId)
        .first();

      if (!participant) {
        return jsonResponse(
          { error: "找不到參賽者" },
          404
        );
      }

      const duplicate = await env.DB
        .prepare(`
          SELECT id
          FROM participants
          WHERE name = ?
          AND id != ?
          LIMIT 1
        `)
        .bind(
          name,
          participantId
        )
        .first();

      if (duplicate) {
        return jsonResponse(
          { error: "這個姓名已經存在" },
          409
        );
      }

      const now = await getNextTimestamp(env);

      await env.DB
        .prepare(`
          UPDATE participants
          SET name = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .bind(
          name,
          now,
          participantId
        )
        .run();

      await env.DB
        .prepare(`
          INSERT INTO operation_logs (
            action,
            participant_id,
            old_score,
            new_score,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          "EDIT_NAME",
          participantId,
          participant.score,
          participant.score,
          now
        )
        .run();

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true
      });
    }

    // =========================
    // 修改分數
    // =========================
    if (
      url.pathname.match(
        /^\/api\/participants\/\d+\/score$/
      ) &&
      request.method === "PATCH"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const participantId = Number(
        url.pathname.split("/")[3]
      );

      const body = await request.json();

      const participant = await env.DB
        .prepare(`
          SELECT *
          FROM participants
          WHERE id = ?
        `)
        .bind(participantId)
        .first();

      if (!participant) {
        return jsonResponse(
          { error: "找不到參賽者" },
          404
        );
      }

      let newScore;

      if (body.delta !== undefined) {
        const delta = Number(body.delta);

        if (!Number.isInteger(delta)) {
          return jsonResponse(
            { error: "分數變更必須是整數" },
            400
          );
        }

        newScore = Math.max(
          0,
          Number(participant.score) + delta
        );
      } else {
        newScore = Number(body.score);

        if (!Number.isInteger(newScore)) {
          return jsonResponse(
            { error: "分數必須是整數" },
            400
          );
        }

        newScore = Math.max(
          0,
          newScore
        );
      }

      const oldScore =
        Number(participant.score);

      if (newScore === oldScore) {
        return jsonResponse({
          success: true
        });
      }

      const now = await getNextTimestamp(env);

      const action =
        body.delta !== undefined
          ? "ADJUST_SCORE"
          : "SET_SCORE";

      await env.DB.batch([
        env.DB
          .prepare(`
            UPDATE participants
            SET score = ?,
                updated_at = ?
            WHERE id = ?
          `)
          .bind(
            newScore,
            now,
            participantId
          ),

        env.DB
          .prepare(`
            INSERT INTO operation_logs (
              action,
              participant_id,
              old_score,
              new_score,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            action,
            participantId,
            oldScore,
            newScore,
            now
          )
      ]);

      await createRankingSnapshot(
        env,
        now
      );

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true,
        score: newScore
      });
    }

    // =========================
    // 刪除參賽者
    // =========================
    if (
      url.pathname.match(
        /^\/api\/participants\/\d+$/
      ) &&
      request.method === "DELETE"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const participantId = Number(
        url.pathname.split("/").pop()
      );

      const participant = await env.DB
        .prepare(`
          SELECT *
          FROM participants
          WHERE id = ?
        `)
        .bind(participantId)
        .first();

      if (!participant) {
        return jsonResponse(
          { error: "找不到參賽者" },
          404
        );
      }

      const now = await getNextTimestamp(env);

      await env.DB.batch([
        env.DB
          .prepare(`
            DELETE FROM participants
            WHERE id = ?
          `)
          .bind(participantId),

        env.DB
          .prepare(`
            INSERT INTO operation_logs (
              action,
              participant_id,
              old_score,
              new_score,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            "DELETE_PARTICIPANT",
            participantId,
            participant.score,
            null,
            now
          )
      ]);

      await createRankingSnapshot(
        env,
        now
      );

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true
      });
    }

    // =========================
    // Undo
    // =========================
    if (
      url.pathname === "/api/undo" &&
      request.method === "POST"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const lastUndo = await env.DB
        .prepare(`
          SELECT id
          FROM operation_logs
          WHERE action LIKE 'UNDO:%'
          ORDER BY id DESC
          LIMIT 1
        `)
        .first();

      const undoBoundary =
        lastUndo?.id || 0;

      const lastOperation = await env.DB
        .prepare(`
          SELECT *
          FROM operation_logs
          WHERE action IN (
            'SET_SCORE',
            'ADJUST_SCORE'
          )
          AND id > ?
          AND NOT EXISTS (
            SELECT 1
            FROM operation_logs u
            WHERE u.action = 'UNDO:' || CAST(operation_logs.id AS TEXT)
          )
          ORDER BY id DESC
          LIMIT 1
        `)
        .bind(undoBoundary)
        .first();

      if (!lastOperation) {
        return jsonResponse(
          { error: "目前沒有可以復原的操作" },
          400
        );
      }

      const participant = await env.DB
        .prepare(`
          SELECT *
          FROM participants
          WHERE id = ?
        `)
        .bind(
          lastOperation.participant_id
        )
        .first();

      if (!participant) {
        return jsonResponse(
          { error: "原參賽者已不存在，無法復原" },
          400
        );
      }

      const now = await getNextTimestamp(env);

      await env.DB.batch([
        env.DB
          .prepare(`
            UPDATE participants
            SET score = ?,
                updated_at = ?
            WHERE id = ?
          `)
          .bind(
            lastOperation.old_score,
            now,
            lastOperation.participant_id
          ),

        env.DB
          .prepare(`
            INSERT INTO operation_logs (
              action,
              participant_id,
              old_score,
              new_score,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            `UNDO:${lastOperation.id}`,
            lastOperation.participant_id,
            participant.score,
            lastOperation.old_score,
            now
          )
      ]);

      await createRankingSnapshot(
        env,
        now
      );

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true
      });
    }

    // =========================
    // 操作紀錄
    // =========================
    if (
      url.pathname === "/api/logs" &&
      request.method === "GET"
    ) {
      const session = await requireAdmin(
        request,
        env
      );

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const { results } = await env.DB
        .prepare(`
          SELECT
            operation_logs.id,
            operation_logs.action,
            operation_logs.participant_id,
            operation_logs.old_score,
            operation_logs.new_score,
            operation_logs.created_at,
            participants.name
          FROM operation_logs
          LEFT JOIN participants
            ON participants.id = operation_logs.participant_id
          ORDER BY operation_logs.id DESC
          LIMIT 30
        `)
        .all();

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        logs: results || []
      });
    }

    // =========================
    // 其他 API
    // =========================
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({
        status: "ok"
      });
    }

    return env.ASSETS.fetch(request);
  }
};


// =========================
// 取得參賽者
// =========================
async function getParticipants(env) {
  const { results } = await env.DB
    .prepare(`
      SELECT
        id,
        name,
        score,
        created_at,
        updated_at
      FROM participants
      ORDER BY score DESC, id ASC
    `)
    .all();

  return results || [];
}


// =========================
// 建立目前排名
// =========================
function buildRanking(participants) {
  return [...participants]
    .sort((a, b) => {
      const scoreDiff =
        Number(b.score) - Number(a.score);

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return Number(a.id) - Number(b.id);
    })
    .map((participant, index) => ({
      ...participant,
      rank: index + 1
    }));
}


// =========================
// 建立排名快照
// =========================
async function createRankingSnapshot(
  env,
  timestamp
) {
  const participants =
    await getParticipants(env);

  const ranking =
    buildRanking(participants);

  if (!ranking.length) {
    return;
  }

  const statements =
    ranking.map((participant) => {
      return env.DB
        .prepare(`
          INSERT INTO ranking_history (
            participant_id,
            rank,
            created_at
          )
          VALUES (?, ?, ?)
        `)
        .bind(
          participant.id,
          participant.rank,
          timestamp
        );
    });

  await env.DB.batch(statements);
}


// =========================
// 取得下一個時間戳
// =========================
async function getNextTimestamp(env) {
  const latest = await env.DB
    .prepare(`
      SELECT created_at
      FROM ranking_history
      ORDER BY id DESC
      LIMIT 1
    `)
    .first();

  const now = Date.now();

  if (latest?.created_at) {
    const latestTime =
      new Date(latest.created_at).getTime();

    if (now <= latestTime) {
      return new Date(
        latestTime + 1
      ).toISOString();
    }
  }

  return new Date(now).toISOString();
}


// =========================
// Cookie
// =========================
function getCookie(request, name) {
  const cookieHeader =
    request.headers.get("Cookie") || "";

  const cookies =
    cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] =
      cookie.trim().split("=");

    if (key === name) {
      return valueParts.join("=");
    }
  }

  return null;
}


// =========================
// Session
// =========================
async function getSession(request, env) {
  const token = getCookie(
    request,
    SESSION_COOKIE
  );

  if (!token) {
    return null;
  }

  const session = await env.DB
    .prepare(`
      SELECT
        id,
        token,
        expires_at,
        created_at
      FROM sessions
      WHERE token = ?
    `)
    .bind(token)
    .first();

  if (!session) {
    return null;
  }

  const expiresAt =
    new Date(session.expires_at);

  if (
    expiresAt.getTime() <=
    Date.now()
  ) {
    await env.DB
      .prepare(`
        DELETE FROM sessions
        WHERE token = ?
      `)
      .bind(token)
      .run();

    return null;
  }

  return session;
}


// =========================
// 管理員驗證
// =========================
async function requireAdmin(
  request,
  env
) {
  return await getSession(
    request,
    env
  );
}


// =========================
// 延長 Session
// =========================
async function refreshSession(
  token,
  env
) {
  const expiresAt =
    new Date(
      Date.now() +
      SESSION_MINUTES * 60 * 1000
    );

  await env.DB
    .prepare(`
      UPDATE sessions
      SET expires_at = ?
      WHERE token = ?
    `)
    .bind(
      expiresAt.toISOString(),
      token
    )
    .run();
}


// =========================
// JSON Response
// =========================
function jsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}
