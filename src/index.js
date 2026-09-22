const SESSION_COOKIE = "admin_session";
const SESSION_MINUTES = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // 公開排名
    // =========================
    if (url.pathname === "/api/state" && request.method === "GET") {
      const { results } = await env.DB
        .prepare(`
          SELECT id, name, score, created_at, updated_at
          FROM participants
          ORDER BY score DESC, id ASC
        `)
        .run();

      const updatedAt = results.length
        ? results.reduce((latest, participant) => {
            return participant.updated_at > latest
              ? participant.updated_at
              : latest;
          }, results[0].updated_at)
        : null;

      return Response.json({
        participants: results,
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
        return Response.json(
          { error: "密碼錯誤" },
          { status: 401 }
        );
      }

      const token = crypto.randomUUID();
      const now = new Date();

      const expiresAt = new Date(
        now.getTime() + SESSION_MINUTES * 60 * 1000
      );

      await env.DB
        .prepare(`
          INSERT INTO sessions (token, expires_at, created_at)
          VALUES (?, ?, ?)
        `)
        .bind(
          token,
          expiresAt.toISOString(),
          now.toISOString()
        )
        .run();

      const response = Response.json({
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
      const token = getCookie(request, SESSION_COOKIE);

      if (token) {
        await env.DB
          .prepare(`
            DELETE FROM sessions
            WHERE token = ?
          `)
          .bind(token)
          .run();
      }

      const response = Response.json({
        success: true
      });

      response.headers.set(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      );

      return response;
    }

    // =========================
    // 檢查管理員登入狀態
    // =========================
    if (url.pathname === "/api/me" && request.method === "GET") {
      const session = await getSession(request, env);

      if (!session) {
        return Response.json(
          { authenticated: false },
          { status: 401 }
        );
      }

      await refreshSession(session.token, env);

      return Response.json({
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
      const session = await requireAdmin(request, env);

      if (!session) {
        return Response.json(
          { error: "未登入管理員帳號" },
          { status: 401 }
        );
      }

      const body = await request.json();

      const name = String(body.name || "").trim();

      if (!name) {
        return Response.json(
          { error: "請輸入參賽者姓名" },
          { status: 400 }
        );
      }

      if (name.length > 50) {
        return Response.json(
          { error: "參賽者姓名最多 50 個字" },
          { status: 400 }
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
        return Response.json(
          { error: "參賽者已存在" },
          { status: 409 }
        );
      }

      const now = new Date().toISOString();

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

      const participantId = insertResult.meta.last_row_id;

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

      await refreshSession(session.token, env);

      return Response.json({
        success: true,
        participant: {
          id: participantId,
          name,
          score: 0,
          created_at: now,
          updated_at: now
        }
      });
    }

    // =========================
    // 其他 API
    // =========================
    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        status: "ok"
      });
    }

    return env.ASSETS.fetch(request);
  }
};


// =========================
// 讀取 Cookie
// =========================
function getCookie(request, name) {
  const cookieHeader =
    request.headers.get("Cookie") || "";

  const cookies = cookieHeader.split(";");

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
// 取得有效 Session
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
      SELECT id, token, expires_at, created_at
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

  if (expiresAt.getTime() <= Date.now()) {
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
async function requireAdmin(request, env) {
  const session =
    await getSession(request, env);

  if (!session) {
    return null;
  }

  return session;
}


// =========================
// 延長 Session
// =========================
async function refreshSession(token, env) {
  const expiresAt = new Date(
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
