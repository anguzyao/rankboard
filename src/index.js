const SESSION_COOKIE = "admin_session";
const SESSION_MINUTES = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // 公開排名
    // =========================
    if (
      url.pathname === "/api/state" &&
      request.method === "GET"
    ) {
      const participants =
        await getParticipants(env);

      const ranking =
        buildRanking(participants);

      return jsonResponse({
        participants: ranking,
        updatedAt: getLatestUpdatedAt(
          participants
        )
      });
    }

    // =========================
    // 取得網站設定
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
        await requireAdmin(request, env);

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const body =
        await request.json();

      const title =
        String(body.title || "").trim();

      if (!title) {
        return jsonResponse(
          { error: "標題不能為空白" },
          400
        );
      }

      if (title.length > 50) {
        return jsonResponse(
          { error: "標題最多 50 個字" },
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
    // 取得競賽列表
    // =========================
    if (
      url.pathname === "/api/competitions" &&
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
    // =========================
    if (
      url.pathname === "/api/competitions" &&
      request.method === "POST"
    ) {
      const session =
        await requireAdmin(request, env);

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const body =
        await request.json();

      const name =
        String(body.name || "").trim();

      if (!name) {
        return jsonResponse(
          { error: "競賽名稱不能為空白" },
          400
        );
      }

      if (name.length > 50) {
        return jsonResponse(
          { error: "競賽名稱最多 50 個字" },
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
          { error: "競賽名稱已存在" },
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
          ? Number(latest.sort_order) + 1
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

      await refreshSession(
        session.token,
        env
      );

      return jsonResponse({
        success: true,
        competition: {
          id: result.meta.last_row_id,
          name,
          sort_order: sortOrder,
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
        await requireAdmin(request, env);

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const competitionId =
        Number(
          url.pathname.split("/").pop()
        );

      const body =
        await request.json();

      const name =
        String(body.name || "").trim();

      if (!name) {
        return jsonResponse(
          { error: "競賽名稱不能為空白" },
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
          .bind(competitionId)
          .first();

      if (!competition) {
        return jsonResponse(
          { error: "找不到競賽" },
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
          { error: "競賽名稱已存在" },
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
        await requireAdmin(request, env);

      if (!session) {
        return jsonResponse(
          { error: "未登入管理員帳號" },
          401
        );
      }

      const competitionId =
        Number(
          url.pathname.split("/").pop()
        );

      const competition =
        await env.DB
          .prepare(`
            SELECT *
            FROM competitions
            WHERE id = ?
          `)
          .bind(competitionId)
          .first();

      if (!competition) {
        return jsonResponse(
          { error: "找不到競賽" },
          404
        );
      }

      await env.DB
        .prepare(`
          DELETE FROM competitions
          WHERE id = ?
        `)
        .bind(competitionId)
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
        String(body.password || "");

      if (
        password.trim() !==
        String(
          env.ADMIN_PASSWORD || ""
        ).trim()
      ) {
        return jsonResponse(
          { error: "密碼錯誤" },
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
            authenticated: false
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
    // 其他 API
    // =========================
    if (
      url.pathname.startsWith("/api/")
    ) {
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
        ORDER BY score DESC, id ASC
      `)
      .all();

  return results || [];
}


// =========================
// 建立排名
// =========================
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


// =========================
// 取得競賽
// =========================
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
        ORDER BY sort_order ASC, id ASC
      `)
      .all();

  return results || [];
}


// =========================
// 取得網站設定
// =========================
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


// =========================
// 最新更新時間
// =========================
function getLatestUpdatedAt(
  participants
) {
  if (!participants.length) {
    return null;
  }

  return participants.reduce(
    (latest, participant) => {
      return participant.updated_at >
        latest
        ? participant.updated_at
        : latest;
    },
    participants[0].updated_at
  );
}


// =========================
// Cookie
// =========================
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


// =========================
// Session
// =========================
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
