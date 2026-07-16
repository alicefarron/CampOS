import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { pg } from "./db/client.js";

type NotificationRow = {
  id: string;
  participant_id: string;
  subject: string;
  body: string;
  source_event_id: string;
  created_at: Date;
};

export function buildApp() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  void app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: { title: "Notification Service", version: "0.0.1" },
      tags: [{ name: "Notifications", description: "Participant notifications" }],
    },
  });
  void app.register(swaggerUi, { routePrefix: "/swagger" });

  app.get<{ Querystring: { participantId?: string } }>("/notifications", {
    schema: {
      tags: ["Notifications"],
      summary: "List notifications",
      querystring: {
        type: "object",
        properties: {
          participantId: { type: "string", description: "Filter by participant ID" },
        },
      },
    },
  }, async (request, reply) => {
    const { participantId } = request.query;

    const rows = await pg<NotificationRow[]>`
      SELECT *
      FROM   notifications
      WHERE  (${participantId ?? null}::text IS NULL OR participant_id = ${participantId ?? null}::text)
      ORDER  BY created_at DESC
    `;

    return reply.send(rows);
  });

  return app;
}
