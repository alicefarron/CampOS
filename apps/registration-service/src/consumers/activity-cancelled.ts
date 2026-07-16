import { ACTIVITY_EVENT_TYPES, PARTICIPANT_EVENT_TYPES, TOPICS } from "@campost/shared-events";
import type { ActivityCancelledEvent, RegistrationCancelledEvent } from "@campost/shared-events";
import { Kafka } from "kafkajs";
import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { pg } from "../db/client.js";

type RegRow = {
  id: string;
  camp_id: string;
  participant_id: string;
};

export async function startActivityCancelledConsumer(): Promise<() => Promise<void>> {
  const kafka = new Kafka({
    clientId: "registration-service-activities-consumer",
    brokers: config.KAFKA_BROKERS.split(","),
  });

  const consumer = kafka.consumer({ groupId: "registration-service-activities" });

  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.ACTIVITIES, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let parsed: { eventType: string };
      try {
        parsed = JSON.parse(message.value.toString()) as { eventType: string };
      } catch {
        console.error("[consumer:activities] failed to parse message, skipping");
        return;
      }

      if (parsed.eventType !== ACTIVITY_EVENT_TYPES.ACTIVITY_CANCELLED) return;

      const event = parsed as unknown as ActivityCancelledEvent;
      const { activityId, campId } = event.payload;
      const cancelledAt = new Date().toISOString();

      const count = await pg.begin(async (sql): Promise<number> => {
        const [seen] = await sql<[{ event_id: string }?]>`
          SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
        `;
        if (seen) {
          console.log(`[consumer:activities] duplicate event ${event.eventId} — skipping`);
          return 0;
        }

        // Lock all active registrations for the cancelled activity.
        // FOR UPDATE blocks concurrent DELETE /registrations/:id on the same rows,
        // preventing a double-cancel race. PostgreSQL re-evaluates WHERE after
        // the lock is granted, so rows already cancelled by a concurrent DELETE
        // are silently excluded from the result set.
        const regs = await sql<RegRow[]>`
          SELECT id, camp_id, participant_id
          FROM   registrations
          WHERE  activity_id = ${activityId}
            AND  status != 'cancelled'
          FOR UPDATE
        `;

        for (const reg of regs) {
          await sql`
            UPDATE registrations
            SET    status = 'cancelled', cancelled_at = ${cancelledAt}
            WHERE  id = ${reg.id}
          `;

          const cancelEvent: RegistrationCancelledEvent = {
            eventId: randomUUID(),
            eventType: PARTICIPANT_EVENT_TYPES.REGISTRATION_CANCELLED,
            version: 1,
            occurredAt: cancelledAt,
            payload: {
              registrationId: reg.id,
              campId: reg.camp_id,
              participantId: reg.participant_id,
              cancelledAt,
            },
          };

          await sql`
            INSERT INTO outbox_events (event_type, topic, payload)
            VALUES (
              ${cancelEvent.eventType},
              ${TOPICS.REGISTRATIONS},
              ${JSON.stringify(cancelEvent)}
            )
          `;
        }

        await sql`
          INSERT INTO processed_events (event_id, event_type)
          VALUES (${event.eventId}, ${event.eventType})
        `;

        return regs.length;
      });

      console.log(
        `[consumer:activities] ActivityCancelled ${activityId} (camp ${campId})` +
        ` → cancelled ${count} registration(s)`,
      );
    },
  });

  return () => consumer.disconnect();
}
