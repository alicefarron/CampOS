import { CAMP_EVENT_TYPES, TOPICS } from "@campost/shared-events";
import type { CampCreatedEvent } from "@campost/shared-events";
import { Kafka } from "kafkajs";

import { config } from "../config.js";
import { pg } from "../db/client.js";

export async function startCampConsumer(): Promise<() => Promise<void>> {
  const kafka = new Kafka({
    clientId: "registration-service-consumer",
    brokers: config.KAFKA_BROKERS.split(","),
  });

  const consumer = kafka.consumer({ groupId: "registration-service-camps" });

  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.CAMPS, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let event: CampCreatedEvent;
      try {
        event = JSON.parse(message.value.toString()) as CampCreatedEvent;
      } catch {
        console.error("[consumer:camps] failed to parse message, skipping");
        return;
      }

      if (event.eventType !== CAMP_EVENT_TYPES.CAMP_CREATED) return;

      await pg.begin(async (sql) => {
        // ── Idempotency check ────────────────────────────────────────────
        // If this eventId was already processed (e.g. Kafka redelivery after
        // a consumer restart), skip without modifying any state.
        const [seen] = await sql<[{ event_id: string }?]>`
          SELECT event_id
          FROM   processed_events
          WHERE  event_id = ${event.eventId}
        `;
        if (seen) {
          console.log(`[consumer:camps] duplicate event ${event.eventId} — skipping`);
          return;
        }

        // ── Business write ───────────────────────────────────────────────
        await sql`
          INSERT INTO camps_projection (id, capacity)
          VALUES (${event.payload.campId}, ${event.payload.capacity})
          ON CONFLICT (id) DO UPDATE SET capacity = EXCLUDED.capacity
        `;

        // ── Mark processed (same transaction) ────────────────────────────
        // Atomicity guarantees: if the business write succeeds, the event is
        // marked processed. If either fails, both roll back and Kafka will
        // redeliver — the idempotency check will guard against double-apply.
        await sql`
          INSERT INTO processed_events (event_id, event_type)
          VALUES (${event.eventId}, ${event.eventType})
        `;
      });

      console.log(`[consumer:camps] processed CampCreated ${event.payload.campId}`);
    },
  });

  return () => consumer.disconnect();
}
