const SESSION_COOKIE = "admin_session";
const SESSION_MINUTES = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // 公開排名
    //
    // /api/state
    //     → 總積分
    //
    // /api/state?competition=1
    //     → 指定競賽
    // =========================
    if (
      url.pathname === "/api/state" &&
      request.method === "GET"
    ) {
      const competitionId =
        url.searchParams.get(
          "competition"
        );

      const ranking =
        await getRanking(
          env,
          competitionId
        );

      return jsonResponse({
        participants: ranking.participants,
        updatedAt: ranking.updatedAt,
        competitionId:
          competitionId || "total"
      });
    }

    // =========================
    // 網站設定
    // =========================
    if (
      url.pathname === "/api/settings" &&
      request.method === "GET"
    ) {
      const settings =
        await getSiteSettings(env);

      return jsonResponse({
        settings
      });
    }

    // =========================
    // 修改網站標題
    // =========================
    if (
      url.pathname === "/api/settings" &&
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

      const body =
        await request.json();

      const title =
        String(
          body.title || ""
        ).trim();

      if (!title) {
        return jsonResponse(
          {
            error:
              "標題不能為空白"
          },
          400
        );
      }

      if (title.length > 50) {
        return jsonResponse(
          {
            error:
              "標題最多 50 個字"
          },
          400
        );
      }

      const now =
        new Date().toISOString();

      await env.DB
        .prepare(`
          INSERT INTO site_settings (
            key,
            value,
            updated_at
          )
          VALUES (?, ?, ?)
          ON CONFLICT(key)
          DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `)
        .bind(
          "site_title",
          title,
          now
        )
        .run();

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true,
        title
      });
    }

    // =========================
    // 取得競賽
    // =========================
    if (
      url.pathname ===
        "/api/competitions" &&
      request.method === "GET"
    ) {
      const competitions =
        await getCompetitions(env);

      return jsonResponse({
        competitions
      });
    }

    // =========================
    // 新增競賽
    //
    // 第一個競賽建立時：
    // 把目前 participants.score
    // 帶入第一個競賽。
    //
    // 這樣不會讓你目前測試分數
    // 突然全部消失。
    // =========================
    if (
      url.pathname ===
        "/api/competitions" &&
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

      const body =
        await request.json();

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {
        return jsonResponse(
          {
            error:
              "競賽名稱不能為空白"
          },
          400
        );
      }

      if (name.length > 50) {
        return jsonResponse(
          {
            error:
              "競賽名稱最多 50 個字"
          },
          400
        );
      }

      const existing =
        await env.DB
          .prepare(`
            SELECT id
            FROM competitions
            WHERE name = ?
            LIMIT 1
          `)
          .bind(name)
          .first();

      if (existing) {
        return jsonResponse(
          {
            error:
              "競賽名稱已存在"
          },
          409
        );
      }

      const latest =
        await env.DB
          .prepare(`
            SELECT
              sort_order
            FROM competitions
            ORDER BY sort_order DESC
            LIMIT 1
          `)
          .first();

      const sortOrder =
        latest
          ? Number(
              latest.sort_order
            ) + 1
          : 1;

      const now =
        new Date().toISOString();

      const result =
        await env.DB
          .prepare(`
            INSERT INTO competitions (
              name,
              sort_order,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            name,
            sortOrder,
            now,
            now
          )
          .run();

      const competitionId =
        result.meta.last_row_id;

      /*
       * 如果是第一個競賽，
       * 把舊的 participants.score
       * 搬進這個競賽。
       *
       * 後續新增的競賽一律從 0 開始。
       */
      const competitionCount =
        await env.DB
          .prepare(`
            SELECT COUNT(*) AS count
            FROM competitions
          `)
          .first();

      if (
        Number(
          competitionCount?.count
        ) === 1
      ) {
        const participants =
          await getParticipants(env);

        const statements =
          participants.map(
            (participant) =>
              env.DB
                .prepare(`
                  INSERT INTO competition_scores (
                    competition_id,
                    participant_id,
                    score,
                    updated_at
                  )
                  VALUES (?, ?, ?, ?)
                `)
                .bind(
                  competitionId,
                  participant.id,
                  Number(
                    participant.score
                  ) || 0,
                  now
                )
          );

        if (statements.length) {
          await env.DB.batch(
            statements
          );
        }
      }

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true,
        competition: {
          id: competitionId,
          name,
          sort_order:
            sortOrder,
          created_at: now,
          updated_at: now
        }
      });
    }

    // =========================
    // 修改競賽名稱
    // =========================
    if (
      url.pathname.match(
        /^\/api\/competitions\/\d+$/
      ) &&
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

      const competitionId =
        Number(
          url.pathname
            .split("/")
            .pop()
        );

      const body =
        await request.json();

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {
        return jsonResponse(
          {
            error:
              "競賽名稱不能為空白"
          },
          400
        );
      }

      const competition =
        await env.DB
          .prepare(`
            SELECT *
            FROM competitions
            WHERE id = ?
          `)
          .bind(
            competitionId
          )
          .first();

      if (!competition) {
        return jsonResponse(
          {
            error:
              "找不到競賽"
          },
          404
        );
      }

      const duplicate =
        await env.DB
          .prepare(`
            SELECT id
            FROM competitions
            WHERE name = ?
            AND id != ?
            LIMIT 1
          `)
          .bind(
            name,
            competitionId
          )
          .first();

      if (duplicate) {
        return jsonResponse(
          {
            error:
              "競賽名稱已存在"
          },
          409
        );
      }

      const now =
        new Date().toISOString();

      await env.DB
        .prepare(`
          UPDATE competitions
          SET name = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .bind(
          name,
          now,
          competitionId
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
    // 刪除競賽
    // =========================
    if (
      url.pathname.match(
        /^\/api\/competitions\/\d+$/
      ) &&
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

      const competitionId =
        Number(
          url.pathname
            .split("/")
            .pop()
        );

      const competition =
        await env.DB
          .prepare(`
            SELECT *
            FROM competitions
            WHERE id = ?
          `)
          .bind(
            competitionId
          )
          .first();

      if (!competition) {
        return jsonResponse(
          {
            error:
              "找不到競賽"
          },
          404
        );
      }

      await env.DB
        .prepare(`
          DELETE FROM competitions
          WHERE id = ?
        `)
        .bind(
          competitionId
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
    // 管理員登入
    // =========================
    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      const password =
        String(
          body.password || ""
        );

      if (
        password.trim() !==
        String(
          env.ADMIN_PASSWORD || ""
        ).trim()
      ) {
        return jsonResponse(
          {
            error:
              "密碼錯誤"
          },
          401
        );
      }

      const token =
        crypto.randomUUID();

      const now =
        new Date();

      const expiresAt =
        new Date(
          now.getTime() +
            SESSION_MINUTES *
              60 *
              1000
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

      const response =
        jsonResponse({
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
    if (
      url.pathname === "/api/logout" &&
      request.method === "POST"
    ) {
      const token =
        getCookie(
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

      const response =
        jsonResponse({
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
    if (
      url.pathname === "/api/me" &&
      request.method === "GET"
    ) {
      const session =
        await getSession(
          request,
          env
        );

      if (!session) {
        return jsonResponse(
          {
            authenticated:
              false
          },
          401
        );
      }

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        authenticated: true
      });
    }

    // =========================
    // 新增參賽者
    // =========================
    if (
      url.pathname ===
        "/api/participants" &&
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

      const body =
        await request.json();

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {
        return jsonResponse(
          {
            error:
              "請輸入參賽者姓名"
          },
          400
        );
      }

      if (name.length > 50) {
        return jsonResponse(
          {
            error:
              "參賽者姓名最多 50 個字"
          },
          400
        );
      }

      const existing =
        await env.DB
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
          {
            error:
              "參賽者已存在"
          },
          409
        );
      }

      const now =
        new Date().toISOString();

      const result =
        await env.DB
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
        result.meta.last_row_id;

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

      /*
       * 已經有競賽時，
       * 新參賽者自動加入所有競賽，
       * 每個競賽初始 0 分。
       */
      const competitions =
        await getCompetitions(env);

      if (competitions.length) {
        const statements =
          competitions.map(
            (competition) =>
              env.DB
                .prepare(`
                  INSERT INTO competition_scores (
                    competition_id,
                    participant_id,
                    score,
                    updated_at
                  )
                  VALUES (?, ?, 0, ?)
                `)
                .bind(
                  competition.id,
                  participantId,
                  now
                )
          );

        await env.DB.batch(
          statements
        );
      }

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
      url.pathname.match(
        /^\/api\/participants\/\d+$/
      ) &&
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

      const participantId =
        Number(
          url.pathname
            .split("/")
            .pop()
        );

      const body =
        await request.json();

      const name =
        String(
          body.name || ""
        ).trim();

      if (!name) {
        return jsonResponse(
          {
            error:
              "姓名不能為空白"
          },
          400
        );
      }

      const participant =
        await env.DB
          .prepare(`
            SELECT *
            FROM participants
            WHERE id = ?
          `)
          .bind(
            participantId
          )
          .first();

      if (!participant) {
        return jsonResponse(
          {
            error:
              "找不到參賽者"
          },
          404
        );
      }

      const duplicate =
        await env.DB
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
          {
            error:
              "這個姓名已經存在"
          },
          409
        );
      }

      const now =
        new Date().toISOString();

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
    //
    // /api/participants/:id/score
    //
    // 可帶：
    // competition=1
    //
    // 沒有 competition：
    // 使用總積分舊模式
    //
    // 有 competition：
    // 修改指定競賽分數
    // =========================
    if (
      url.pathname.match(
        /^\/api\/participants\/\d+\/score$/
      ) &&
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

      const participantId =
        Number(
          url.pathname
            .split("/")[3]
        );

      const competitionId =
        url.searchParams.get(
          "competition"
        );

      const body =
        await request.json();

      const participant =
        await env.DB
          .prepare(`
            SELECT *
            FROM participants
            WHERE id = ?
          `)
          .bind(
            participantId
          )
          .first();

      if (!participant) {
        return jsonResponse(
          {
            error:
              "找不到參賽者"
          },
          404
        );
      }

      // =========================
      // 指定競賽分數
      // =========================
      if (competitionId) {
        return await updateCompetitionScore(
          request,
          env,
          session,
          participant,
          Number(
            competitionId
          ),
          body
        );
      }

      // =========================
      // 舊的總分模式
      //
      // 在競賽正式啟用前保留。
      // =========================

      let newScore;

      if (
        body.delta !== undefined
      ) {
        const delta =
          Number(body.delta);

        if (
          !Number.isInteger(delta)
        ) {
          return jsonResponse(
            {
              error:
                "分數變更必須是整數"
            },
            400
          );
        }

        newScore =
          Math.max(
            0,
            Number(
              participant.score
            ) + delta
          );
      } else {
        newScore =
          Number(body.score);

        if (
          !Number.isInteger(
            newScore
          )
        ) {
          return jsonResponse(
            {
              error:
                "分數必須是整數"
            },
            400
          );
        }

        newScore =
          Math.max(
            0,
            newScore
          );
      }

      const oldScore =
        Number(
          participant.score
        );

      if (
        newScore === oldScore
      ) {
        return jsonResponse({
          success: true,
          score: newScore
        });
      }

      const now =
        new Date().toISOString();

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

      const participantId =
        Number(
          url.pathname
            .split("/")
            .pop()
        );

      const participant =
        await env.DB
          .prepare(`
            SELECT *
            FROM participants
            WHERE id = ?
          `)
          .bind(
            participantId
          )
          .first();

      if (!participant) {
        return jsonResponse(
          {
            error:
              "找不到參賽者"
          },
          404
        );
      }

      const now =
        new Date().toISOString();

      await env.DB.batch([
        env.DB
          .prepare(`
            DELETE FROM participants
            WHERE id = ?
          `)
          .bind(
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
            "DELETE_PARTICIPANT",
            participantId,
            participant.score,
            null,
            now
          )
      ]);

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

      const competitionId =
        new URL(request.url)
          .searchParams
          .get("competition");

      if (competitionId) {
        return await undoCompetitionScore(
          env,
          session,
          Number(
            competitionId
          )
        );
      }

      return await undoLegacyScore(
        env,
        session
      );
    }

    // =========================
    // 操作紀錄
    // =========================
    if (
      url.pathname === "/api/logs" &&
      request.method === "GET"
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

      const { results } =
        await env.DB
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
              ON participants.id =
                operation_logs.participant_id
            ORDER BY
              operation_logs.id DESC
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
    if (
      url.pathname.startsWith(
        "/api/"
      )
    ) {
      return jsonResponse({
        status: "ok"
      });
    }

    return env.ASSETS.fetch(
      request
    );
  }
};


// ============================================================
// 取得參賽者
// ============================================================

async function getParticipants(
  env
) {
  const { results } =
    await env.DB
      .prepare(`
        SELECT
          id,
          name,
          score,
          created_at,
          updated_at
        FROM participants
        ORDER BY
          score DESC,
          id ASC
      `)
      .all();

  return results || [];
}


// ============================================================
// 取得競賽
// ============================================================

async function getCompetitions(
  env
) {
  const { results } =
    await env.DB
      .prepare(`
        SELECT
          id,
          name,
          sort_order,
          created_at,
          updated_at
        FROM competitions
        ORDER BY
          sort_order ASC,
          id ASC
      `)
      .all();

  return results || [];
}


// ============================================================
// 取得排名
//
// competitionId = null
// → 總積分
//
// competitionId = 1
// → 指定競賽
// ============================================================

async function getRanking(
  env,
  competitionId
) {
  let participants = [];
  let updatedAt = null;

  if (
    competitionId &&
    Number.isInteger(
      Number(competitionId)
    )
  ) {
    const competition =
      await env.DB
        .prepare(`
          SELECT id
          FROM competitions
          WHERE id = ?
        `)
        .bind(
          Number(competitionId)
        )
        .first();

    if (!competition) {
      return {
        participants: [],
        updatedAt: null
      };
    }

    const { results } =
      await env.DB
        .prepare(`
          SELECT
            participants.id,
            participants.name,
            COALESCE(
              competition_scores.score,
              0
            ) AS score,
            participants.created_at,
            COALESCE(
              competition_scores.updated_at,
              participants.updated_at
            ) AS updated_at
          FROM participants
          LEFT JOIN competition_scores
            ON competition_scores.participant_id =
              participants.id
            AND competition_scores.competition_id =
              ?
          ORDER BY
            score DESC,
            participants.id ASC
        `)
        .bind(
          Number(competitionId)
        )
        .all();

    participants =
      results || [];

  } else {
    /*
     * 總積分：
     *
     * 有競賽 → 所有競賽加總
     *
     * 沒有競賽 → 使用舊 participants.score
     */

    const competitions =
      await getCompetitions(env);

    if (competitions.length) {
      const { results } =
        await env.DB
          .prepare(`
            SELECT
              participants.id,
              participants.name,
              COALESCE(
                SUM(
                  competition_scores.score
                ),
                0
              ) AS score,
              participants.created_at,
              MAX(
                COALESCE(
                  competition_scores.updated_at,
                  participants.updated_at
                )
              ) AS updated_at
            FROM participants
            LEFT JOIN competition_scores
              ON competition_scores.participant_id =
                participants.id
            GROUP BY
              participants.id,
              participants.name,
              participants.created_at
            ORDER BY
              score DESC,
              participants.id ASC
          `)
          .all();

      participants =
        results || [];

    } else {
      participants =
        await getParticipants(env);
    }
  }

  const ranking =
    buildRanking(
      participants
    );

  updatedAt =
    participants.length
      ? participants.reduce(
          (latest, participant) => {
            return participant.updated_at >
              latest
              ? participant.updated_at
              : latest;
          },
          participants[0]
            .updated_at
        )
      : null;

  return {
    participants: ranking,
    updatedAt
  };
}


// ============================================================
// 建立排名
// ============================================================

function buildRanking(
  participants
) {
  return [...participants]
    .sort((a, b) => {
      const scoreDiff =
        Number(b.score) -
        Number(a.score);

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return (
        Number(a.id) -
        Number(b.id)
      );
    })
    .map(
      (participant, index) => ({
        ...participant,
        rank: index + 1
      })
    );
}


// ============================================================
// 更新指定競賽分數
// ============================================================

async function updateCompetitionScore(
  request,
  env,
  session,
  participant,
  competitionId,
  body
) {
  const competition =
    await env.DB
      .prepare(`
        SELECT id
        FROM competitions
        WHERE id = ?
      `)
      .bind(
        competitionId
      )
      .first();

  if (!competition) {
    return jsonResponse(
      {
        error:
          "找不到指定競賽"
      },
      404
    );
  }

  const existing =
    await env.DB
      .prepare(`
        SELECT
          score,
          updated_at
        FROM competition_scores
        WHERE competition_id = ?
        AND participant_id = ?
      `)
      .bind(
        competitionId,
        participant.id
      )
      .first();

  const oldScore =
    Number(
      existing?.score || 0
    );

  let newScore;

  if (
    body.delta !== undefined
  ) {
    const delta =
      Number(body.delta);

    if (
      !Number.isInteger(delta)
    ) {
      return jsonResponse(
        {
          error:
            "分數變更必須是整數"
        },
        400
      );
    }

    newScore =
      Math.max(
        0,
        oldScore + delta
      );

  } else {
    newScore =
      Number(body.score);

    if (
      !Number.isInteger(
        newScore
      )
    ) {
      return jsonResponse(
        {
          error:
            "分數必須是整數"
        },
        400
      );
    }

    newScore =
      Math.max(
        0,
        newScore
      );
  }

  if (
    newScore === oldScore
  ) {
    return jsonResponse({
      success: true,
      score: newScore
    });
  }

  const now =
    new Date().toISOString();

  const action =
    body.delta !== undefined
      ? "COMPETITION_ADJUST_SCORE"
      : "COMPETITION_SET_SCORE";

  await env.DB.batch([
    env.DB
      .prepare(`
        INSERT INTO competition_scores (
          competition_id,
          participant_id,
          score,
          updated_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT (
          competition_id,
          participant_id
        )
        DO UPDATE SET
          score = excluded.score,
          updated_at = excluded.updated_at
      `)
      .bind(
        competitionId,
        participant.id,
        newScore,
        now
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
        `${action}:${competitionId}`,
        participant.id,
        oldScore,
        newScore,
        now
      )
  ]);

  await refreshSession(
    session.token,
    env
  );

  return jsonResponse({
    success: true,
    score: newScore
  });
}


// ============================================================
// Undo 指定競賽
// ============================================================

async function undoCompetitionScore(
  env,
  session,
  competitionId
) {
  const lastOperation =
    await env.DB
      .prepare(`
        SELECT *
        FROM operation_logs
        WHERE action LIKE ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .bind(
        `%:${competitionId}`
      )
      .all();

  const rows =
    lastOperation.results || [];

  if (!rows.length) {
    return jsonResponse(
      {
        error:
          "目前沒有可以復原的競賽分數操作"
      },
      400
    );
  }

  const operation =
    rows[0];

  const participant =
    await env.DB
      .prepare(`
        SELECT *
        FROM participants
        WHERE id = ?
      `)
      .bind(
        operation.participant_id
      )
      .first();

  if (!participant) {
    return jsonResponse(
      {
        error:
          "參賽者不存在"
      },
      400
    );
  }

  const now =
    new Date().toISOString();

  await env.DB.batch([
    env.DB
      .prepare(`
        INSERT INTO competition_scores (
          competition_id,
          participant_id,
          score,
          updated_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT (
          competition_id,
          participant_id
        )
        DO UPDATE SET
          score = excluded.score,
          updated_at = excluded.updated_at
      `)
      .bind(
        competitionId,
        operation.participant_id,
        Number(
          operation.old_score
        ),
        now
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
        `COMPETITION_UNDO:${competitionId}`,
        operation.participant_id,
        operation.new_score,
        operation.old_score,
        now
      )
  ]);

  await refreshSession(
    session.token,
    env
  );

  return jsonResponse({
    success: true
  });
}


// ============================================================
// 舊總分 Undo
// ============================================================

async function undoLegacyScore(
  env,
  session
) {
  const lastOperation =
    await env.DB
      .prepare(`
        SELECT *
        FROM operation_logs
        WHERE action IN (
          'SET_SCORE',
          'ADJUST_SCORE'
        )
        ORDER BY id DESC
        LIMIT 1
      `)
      .first();

  if (!lastOperation) {
    return jsonResponse(
      {
        error:
          "目前沒有可以復原的操作"
      },
      400
    );
  }

  const participant =
    await env.DB
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
      {
        error:
          "原參賽者已不存在"
      },
      400
    );
  }

  const now =
    new Date().toISOString();

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

  await refreshSession(
    session.token,
    env
  );

  return jsonResponse({
    success: true
  });
}


// ============================================================
// 網站設定
// ============================================================

async function getSiteSettings(
  env
) {
  const { results } =
    await env.DB
      .prepare(`
        SELECT
          key,
          value,
          updated_at
        FROM site_settings
      `)
      .all();

  const settings = {};

  for (
    const row of results || []
  ) {
    settings[row.key] =
      row.value;
  }

  return settings;
}


// ============================================================
// Cookie
// ============================================================

function getCookie(
  request,
  name
) {
  const cookieHeader =
    request.headers.get(
      "Cookie"
    ) || "";

  const cookies =
    cookieHeader.split(";");

  for (
    const cookie of cookies
  ) {
    const [
      key,
      ...valueParts
    ] =
      cookie
        .trim()
        .split("=");

    if (key === name) {
      return valueParts.join(
        "="
      );
    }
  }

  return null;
}


// ============================================================
// Session
// ============================================================

async function getSession(
  request,
  env
) {
  const token =
    getCookie(
      request,
      SESSION_COOKIE
    );

  if (!token) {
    return null;
  }

  const session =
    await env.DB
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
    new Date(
      session.expires_at
    );

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


// ============================================================
// 管理員驗證
// ============================================================

async function requireAdmin(
  request,
  env
) {
  return await getSession(
    request,
    env
  );
}


// ============================================================
// 延長 Session
// ============================================================

async function refreshSession(
  token,
  env
) {
  const expiresAt =
    new Date(
      Date.now() +
        SESSION_MINUTES *
          60 *
          1000
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


// ============================================================
// JSON
// ============================================================

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
