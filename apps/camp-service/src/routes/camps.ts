import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { db } from "../db/client.js";
import { camps } from "../db/schema.js";

const CreateCampBody = z.object({
  name: z.string().min(1),
  organiserId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  capacity: z.number().int().positive(),
  location: z.object({
    country: z.string().min(1),
    city: z.string().min(1),
    address: z.string().optional(),
  }),
});

export async function campRoutes(app: FastifyInstance): Promise<void> {
  app.post("/camps", {
    schema: {
      tags: ["Camps"],
      summary: "Create a camp",
      body: {
        type: "object",
        required: ["name", "organiserId", "startDate", "endDate", "capacity", "location"],
        properties: {
          name: { type: "string", minLength: 1 },
          organiserId: { type: "string", format: "uuid" },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          capacity: { type: "integer", minimum: 1 },
          location: {
            type: "object",
            required: ["country", "city"],
            properties: {
              country: { type: "string" },
              city: { type: "string" },
              address: { type: "string" },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const result = CreateCampBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: "Validation error", issues: result.error.issues });
    }

    const body = result.data;

    const [camp] = await db
      .insert(camps)
      .values({
        name: body.name,
        organiserId: body.organiserId,
        startDate: body.startDate,
        endDate: body.endDate,
        capacity: body.capacity,
        location: body.location,
      })
      .returning();

    return reply.status(201).send(camp);
  });
}
