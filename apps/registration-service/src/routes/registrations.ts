import {
  PARTICIPANT_EVENT_TYPES,
  TOPICS,
} from "@campost/shared-events";
import type {
  ParticipantRegisteredEvent,
  RegistrationCancelledEvent,
  WaitlistPromotedEvent,
} from "@campost/shared-events";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { pg } from "../db/client.js";
import { isUniqueViolation, withIdempotency } from "../lib/idempotency.js";

// ---------------------------------------------------------------------------
// Raw row types (postgres.js returns snake_case)
// ---------------------------------------------------------------------------

type CampRow = { id: string; capacity: number };

type RegRow = {
  id: string;
  camp_id: string;
  activity_id: string | null;
  participant_id: string;
  status: string;
  waitlist_position: number | null;
  registered_at: Date;
};

// ---------------------------------------------------------------------------
// Typed application error — avoids `as Error & { code: string }` casts
// ---------------------------------------------------------------------------

class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "CONFLICT",
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBody = z.object({
  campId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  participantId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /registrations
   *
   * Idempotency-Key header (optional, UUID):
   *   - First request → processes and caches response
   *   - Repeat with same key → returns cached response
   *   - Concurrent request with same key → 409 until first completes
   *
   * DB safety net:
   *   - Partial unique index on (participant_id, activity_id | camp_id)
   *     WHERE status != 'cancelled' catches any race that bypasses the app check.
   *   - PostgreSQL 23505 unique_violation is mapped to 409.
   */
  app.post("/registrations", async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", issues: parsed.error.issues });
    }

    const { campId, activityId, participantId } = parsed.data;
    const idempotencyKey = (request.headers["idempotency-key"] as string | undefined)?.trim();

    try {
      const { responseStatus, responseBody } = await withIdempotency(
        idempotencyKey,
        async () => {
          const registration = await pg.begin(async (sql) => {
            // 1 — lock camp row (serialises all writes for this camp)
            const [camp] = await sql<CampRow[]>`
              SELECT id, capacity
              FROM   camps_projection
              WHERE  id = ${campId}
              FOR UPDATE
            `;
            if (!camp) throw new AppError("Camp not found", "NOT_FOUND");

            // 2 — count confirmed seats (within locked scope)
            const [{ count: confirmedCount }] = await sql<[{ count: number }]>`
              SELECT COUNT(*)::int AS count
              FROM   registrations
              WHERE  camp_id = ${campId}
                AND  status  = 'confirmed'
                AND  (${activityId ?? null}::uuid IS NULL OR activity_id = ${activityId ?? null})
            `;

            const capacity = camp.capacity;
            const isConfirmed = confirmedCount < capacity;
            const status: "confirmed" | "waitlisted" = isConfirmed ? "confirmed" : "waitlisted";

            // 3 — waitlist position
            let waitlistPosition: number | null = null;
            if (!isConfirmed) {
              const [{ max }] = await sql<[{ max: number | null }]>`
                SELECT MAX(waitlist_position)::int AS max
                FROM   registrations
                WHERE  camp_id = ${campId}
                  AND  status  = 'waitlisted'
                  AND  (${activityId ?? null}::uuid IS NULL OR activity_id = ${activityId ?? null})
              `;
              waitlistPosition = (max ?? 0) + 1;
            }

            // 4 — insert registration
            // The partial unique index is the safety net here.
            // If a concurrent request slipped through the app-level check,
            // PostgreSQL raises 23505 and we map it to 409.
            const [reg] = (await sql<RegRow[]>`
              INSERT INTO registrations
                (camp_id, activity_id, participant_id, status, waitlist_position)
              VALUES
                (${campId}, ${activityId ?? null}, ${participantId}, ${status}, ${waitlistPosition})
              RETURNING *
            `) as unknown as [RegRow, ...RegRow[]];

            // 5 — outbox event
            const event: ParticipantRegisteredEvent = {
              eventId: randomUUID(),
              eventType: PARTICIPANT_EVENT_TYPES.PARTICIPANT_REGISTERED,
              version: 1,
              occurredAt: new Date().toISOString(),
              payload: {
                registrationId: reg.id,
                campId: reg.camp_id,
                participantId: reg.participant_id,
                registeredAt: reg.registered_at.toISOString(),
                status,
              },
            };

            await sql`
              INSERT INTO outbox_events (event_type, topic, payload)
              VALUES (${event.eventType}, ${TOPICS.REGISTRATIONS}, ${JSON.stringify(event)})
            `;

            return { ...reg, waitlistPosition };
          });

          return { responseStatus: 201, responseBody: registration };
        },
      );

      return reply.status(responseStatus).send(responseBody);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        if (err.code === "NOT_FOUND") return reply.status(404).send({ error: err.message });
        if (err.code === "CONFLICT") return reply.status(409).send({ error: err.message });
      }
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: "Participant is already registered" });
      }
      throw err;
    }
  });

  /**
   * DELETE /registrations/:id
   *
   * Lock order (always camp first → prevents deadlocks):
   *   1. Peek registration → get campId
   *   2. LOCK camps_projection[campId]
   *   3. LOCK registrations[id]
   *   4. Cancel + emit RegistrationCancelled
   *   5. If was 'confirmed' → promote first waitlisted + emit WaitlistPromoted
   */
  app.delete<{ Params: { id: string } }>("/registrations/:id", async (request, reply) => {
    const { id } = request.params;

    try {
      await pg.begin(async (sql) => {
        // 1 — peek (no lock) to obtain campId for the correct lock order
        const [peek] = await sql<Pick<RegRow, "id" | "camp_id" | "status">[]>`
          SELECT id, camp_id, status FROM registrations WHERE id = ${id}
        `;
        if (!peek) throw new AppError("Registration not found", "NOT_FOUND");

        // 2 — lock camp FIRST (deadlock-prevention invariant)
        await sql`SELECT id FROM camps_projection WHERE id = ${peek.camp_id} FOR UPDATE`;

        // 3 — lock registration SECOND and re-read status under lock
        const [reg] = (await sql<RegRow[]>`
          SELECT * FROM registrations WHERE id = ${id} FOR UPDATE
        `) as unknown as [RegRow | undefined, ...RegRow[]];
        if (!reg) throw new AppError("Registration not found", "NOT_FOUND");
        if (reg.status === "cancelled") throw new AppError("Registration is already cancelled", "CONFLICT");

        const cancelledAt = new Date();

        // 4 — cancel
        await sql`
          UPDATE registrations
          SET    status = 'cancelled', cancelled_at = ${cancelledAt}
          WHERE  id = ${id}
        `;

        // 5 — outbox: RegistrationCancelled
        const cancelEvent: RegistrationCancelledEvent = {
          eventId: randomUUID(),
          eventType: PARTICIPANT_EVENT_TYPES.REGISTRATION_CANCELLED,
          version: 1,
          occurredAt: cancelledAt.toISOString(),
          payload: {
            registrationId: reg.id,
            campId: reg.camp_id,
            participantId: reg.participant_id,
            cancelledAt: cancelledAt.toISOString(),
          },
        };

        await sql`
          INSERT INTO outbox_events (event_type, topic, payload)
          VALUES (${cancelEvent.eventType}, ${TOPICS.REGISTRATIONS}, ${JSON.stringify(cancelEvent)})
        `;

        // 6 — promote first waitlisted if a confirmed slot was freed
        if (reg.status === "confirmed") {
          const [waitlisted] = await sql<RegRow[]>`
            SELECT * FROM registrations
            WHERE  camp_id    = ${reg.camp_id}
              AND  activity_id IS NOT DISTINCT FROM ${reg.activity_id}
              AND  status     = 'waitlisted'
            ORDER  BY waitlist_position ASC
            FOR UPDATE
            LIMIT 1
          `;

          if (waitlisted) {
            await sql`
              UPDATE registrations
              SET    status = 'confirmed', waitlist_position = NULL
              WHERE  id = ${waitlisted.id}
            `;

            const promotedAt = new Date().toISOString();

            const promotedEvent: WaitlistPromotedEvent = {
              eventId: randomUUID(),
              eventType: PARTICIPANT_EVENT_TYPES.WAITLIST_PROMOTED,
              version: 1,
              occurredAt: promotedAt,
              payload: {
                registrationId: waitlisted.id,
                campId: waitlisted.camp_id,
                participantId: waitlisted.participant_id,
                promotedAt,
                previousPosition: waitlisted.waitlist_position ?? 1,
              },
            };

            await sql`
              INSERT INTO outbox_events (event_type, topic, payload)
              VALUES (
                ${promotedEvent.eventType},
                ${TOPICS.REGISTRATIONS},
                ${JSON.stringify(promotedEvent)}
              )
            `;

            console.log(
              `[registrations] promoted ${waitlisted.participant_id} ` +
              `from position ${waitlisted.waitlist_position}`,
            );
          }
        }
      });

      return reply.status(204).send();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        if (err.code === "NOT_FOUND") return reply.status(404).send({ error: err.message });
        if (err.code === "CONFLICT") return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
