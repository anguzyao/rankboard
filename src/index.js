export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/state") {
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

    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = await request.json();
      const password = String(body.password || "");

      if (password !== env.ADMIN_PASSWORD) {
        return Response.json(
          { error: "密碼錯誤" },
          { status: 401 }
        );
      }

      return Response.json({
        success: true
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        status: "ok"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
