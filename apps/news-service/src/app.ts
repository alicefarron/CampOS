import Fastify from "fastify";

import { newsRoutes } from "./routes/news.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(newsRoutes);

  return app;
}
