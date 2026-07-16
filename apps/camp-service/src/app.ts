import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { activityRoutes } from "./routes/activities.js";
import { campRoutes } from "./routes/camps.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: { title: "Camp Service", version: "0.0.1" },
      tags: [
        { name: "Camps", description: "Camp management" },
        { name: "Activities", description: "Activity management" },
      ],
    },
  });
  void app.register(swaggerUi, { routePrefix: "/swagger" });

  void app.register(campRoutes);
  void app.register(activityRoutes);

  return app;
}
