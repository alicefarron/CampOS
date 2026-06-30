import Fastify from "fastify";

import { activityRoutes } from "./routes/activities.js";
import { campRoutes } from "./routes/camps.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(campRoutes);
  void app.register(activityRoutes);

  return app;
}
