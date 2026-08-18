export default {
  async fetch(request, env) {
    try {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all();

      return Response.json({
        status: "online",
        database: "connected",
        tables: result.results
      });

    } catch (error) {
      return Response.json({
        status: "error",
        message: error.message
      }, { status: 500 });
    }
  }
};
