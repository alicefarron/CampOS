import Fastify from "fastify";

import { registrationRoutes } from "./routes/registrations.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(registrationRoutes);

  return app;
}
