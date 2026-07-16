import { ACTIVITY_EVENT_TYPES, TOPICS } from "@campost/shared-events";
import type { ActivityCancelledEvent, ActivityCreatedEvent } from "@campost/shared-events";
import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { db } from "../db/client.js";
import { activities, outboxEvents } from "../db/schema.js";

type Activity = InferSelectModel<typeof activities>;

class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "CONFLICT",
  ) {
    super(message);
    this.name = "AppError";
  }
}

const CreateActivityBody = z.object({
  campId: z.string().uuid(),
  title: z.string().min(1),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  capacity: z.number().int().positive(),
  instructorId: z.string().uuid().optional(),
});

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/activities", {
    schema: {
      tags: ["Activities"],
      summary: "Create an activity",
      body: {
        type: "object",
        required: ["campId", "title", "scheduledAt", "durationMinutes", "capacity"],
        properties: {
          campId: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1 },
          scheduledAt: { type: "string", format: "date-time" },
          durationMinutes: { type: "integer", minimum: 1 },
          capacity: { type: "integer", minimum: 1 },
          instructorId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (request, reply) => {
    const result = CreateActivityBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: "Validation error", issues: result.error.issues });
    }

    const body = result.data;

    const activity = await db.transaction(async (tx) => {
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

  app.get<{ Querystring: { campId?: string } }>("/activities", {
    schema: {
      tags: ["Activities"],
      summary: "List activities",
      querystring: {
        type: "object",
        properties: {
          campId: { type: "string", format: "uuid", description: "Filter by camp" },
        },
      },
    },
  }, async (request, reply) => {
    const { campId } = request.query;

    const rows = campId
      ? await db.select().from(activities).where(eq(activities.campId, campId))
      : await db.select().from(activities);

    return reply.send(rows);
  });

  app.delete<{ Params: { id: string } }>("/activities/:id", {
    schema: {
      tags: ["Activities"],
      summary: "Cancel an activity",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const activity = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(activities)
          .where(eq(activities.id, id));
        if (!existing) throw new AppError("Activity not found", "NOT_FOUND");
        if (existing.cancelledAt !== null) {
          throw new AppError("Activity is already cancelled", "CONFLICT");
        }

        const cancelledAt = new Date();

        const [updated] = await tx
          .update(activities)
          .set({ cancelledAt })
          .where(eq(activities.id, id))
          .returning() as [Activity, ...Activity[]];

        const event: ActivityCancelledEvent = {
          eventId: randomUUID(),
          eventType: ACTIVITY_EVENT_TYPES.ACTIVITY_CANCELLED,
          version: 1,
          occurredAt: cancelledAt.toISOString(),
          payload: {
            activityId: updated.id,
            campId: updated.campId,
            title: updated.title,
            cancelledAt: cancelledAt.toISOString(),
          },
        };

        await tx.insert(outboxEvents).values({
          eventType: event.eventType,
          topic: TOPICS.ACTIVITIES,
          payload: event as unknown as Record<string, unknown>,
        });

        return updated;
      });

      return reply.send(activity);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        if (err.code === "NOT_FOUND") return reply.status(404).send({ error: err.message });
        if (err.code === "CONFLICT") return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
