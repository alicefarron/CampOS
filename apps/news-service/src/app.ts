import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { newsRoutes } from "./routes/news.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: { title: "News Service", version: "0.0.1" },
      tags: [{ name: "News", description: "News article management" }],
    },
  });
  void app.register(swaggerUi, { routePrefix: "/swagger" });

  void app.register(newsRoutes);

  return app;
}
