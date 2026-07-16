import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { registrationRoutes } from "./routes/registrations.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: { title: "Registration Service", version: "0.0.1" },
      tags: [
        { name: "Registrations", description: "Participant registrations and waitlist" },
      ],
    },
  });
  void app.register(swaggerUi, { routePrefix: "/swagger" });

  void app.register(registrationRoutes);

  return app;
}
