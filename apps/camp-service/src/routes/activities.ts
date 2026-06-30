import { ACTIVITY_EVENT_TYPES, TOPICS } from "@campost/shared-events";
import type { ActivityCreatedEvent } from "@campost/shared-events";
import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { db } from "../db/client.js";
import { activities, outboxEvents } from "../db/schema.js";

const CreateActivityBody = z.object({
  campId: z.string().uuid(),
  title: z.string().min(1),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  instructorId: z.string().uuid().optional(),
});

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/activities", async (request, reply) => {
    const result = CreateActivityBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: "Validation error", issues: result.error.issues });
    }

    const body = result.data;

    const activity = await db.transaction(async (tx) => {
      type Activity = InferSelectModel<typeof activities>;
      const [act] = await tx
        .insert(activities)
        .values({
          campId: body.campId,
          title: body.title,
          scheduledAt: body.scheduledAt,
          durationMinutes: body.durationMinutes,
          capacity: body.capacity,
          instructorId: body.instructorId ?? null,
        })
        .returning() as [Activity, ...Activity[]];

      const event: ActivityCreatedEvent = {
        eventId: randomUUID(),
        eventType: ACTIVITY_EVENT_TYPES.ACTIVITY_CREATED,
        version: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          activityId: act.id,
          campId: act.campId,
          title: act.title,
          scheduledAt: act.scheduledAt,
          durationMinutes: act.durationMinutes,
          capacity: act.capacity,
          ...(act.instructorId !== null && { instructorId: act.instructorId }),
        },
      };

      await tx.insert(outboxEvents).values({
        eventType: event.eventType,
        topic: TOPICS.ACTIVITIES,
        payload: event as unknown as Record<string, unknown>,
      });

      return act;
    });

    return reply.status(201).send(activity);
  });

  app.get<{ Querystring: { campId?: string } }>("/activities", async (request, reply) => {
    const { campId } = request.query;

    const rows = campId
      ? await db.select().from(activities).where(eq(activities.campId, campId))
      : await db.select().from(activities);

    return reply.send(rows);
  });
}
