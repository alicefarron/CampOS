import {
  ACTIVITY_EVENT_TYPES,
  NEWS_EVENT_TYPES,
  PARTICIPANT_EVENT_TYPES,
  TOPICS,
} from "@campost/shared-events";
import type {
  ActivityCancelledEvent,
  DomainEvent,
  NewsPublishedEvent,
  ParticipantRegisteredEvent,
  RegistrationCancelledEvent,
  WaitlistPromotedEvent,
} from "@campost/shared-events";
import { Kafka } from "kafkajs";
import type { Producer } from "kafkajs";
import { config } from "./config.js";
import { pg } from "./db/client.js";

// ---------------------------------------------------------------------------
// DLQ / retry helpers
// ---------------------------------------------------------------------------

const DLQ_TOPIC = "notification-events-dlq";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

type RawMessage = { value: Buffer | null; key: Buffer | string | null | undefined };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetryAndDlq(
  producer: Producer,
  topic: string,
  message: RawMessage,
  handler: () => Promise<void>,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await handler();
      return;
    } catch (err) {
      lastError = err;
      console.error(
        `[consumer:${topic}] handler failed (attempt ${attempt}/${MAX_RETRIES}):`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  // All retries exhausted — forward to DLQ so the offset can advance.
  const dlqPayload = JSON.stringify({
    originalTopic: topic,
    originalMessage: message.value?.toString() ?? null,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    failedAt: new Date().toISOString(),
    attempts: MAX_RETRIES,
  });

  await producer.send({
    topic: DLQ_TOPIC,
    messages: [{ value: dlqPayload }],
  });

  console.error(
    `[consumer:dlq] message from topic "${topic}" forwarded to ${DLQ_TOPIC} after ${MAX_RETRIES} attempts`,
  );
}

type ParticipantRow = { participant_id: string };
type SeenRow = { event_id: string };

export async function startNotificationConsumer(): Promise<() => Promise<void>> {
  const kafka = new Kafka({
    clientId: "notification-service-consumer",
    brokers: config.KAFKA_BROKERS.split(","),
  });

  const consumer = kafka.consumer({ groupId: "notification-service" });
  const dlqProducer = kafka.producer();

  await consumer.connect();
  await dlqProducer.connect();

  await consumer.subscribe({ topic: TOPICS.REGISTRATIONS, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.ACTIVITIES, fromBeginning: true });
  await consumer.subscribe({ topic: TOPICS.NEWS, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;

      let event: DomainEvent;
      try {
        event = JSON.parse(message.value.toString()) as DomainEvent;
      } catch {
        console.error(`[consumer:${topic}] failed to parse message, skipping`);
        return;
      }

      await withRetryAndDlq(dlqProducer, topic, message, () => handleEvent(event));
    },
  });

  return async () => {
    await consumer.disconnect();
    await dlqProducer.disconnect();
  };
}

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.eventType) {
    case PARTICIPANT_EVENT_TYPES.PARTICIPANT_REGISTERED:
      return handleParticipantRegistered(event);
    case PARTICIPANT_EVENT_TYPES.REGISTRATION_CANCELLED:
      return handleRegistrationCancelled(event);
    case PARTICIPANT_EVENT_TYPES.WAITLIST_PROMOTED:
      return handleWaitlistPromoted(event);
    case ACTIVITY_EVENT_TYPES.ACTIVITY_CANCELLED:
      return handleActivityCancelled(event);
    case NEWS_EVENT_TYPES.NEWS_PUBLISHED:
      return handleNewsPublished(event);
  }
}

// ---------------------------------------------------------------------------
// Registration events — maintain participants_projection
// ---------------------------------------------------------------------------

async function handleParticipantRegistered(event: ParticipantRegisteredEvent): Promise<void> {
  const { registrationId, participantId, campId, status } = event.payload;

  await pg.begin(async (sql): Promise<void> => {
    const [seen] = await sql<[SeenRow?]>`
      SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
    `;
    if (seen) return;

    // Keep a local record of who is registered — needed for fan-out later.
    await sql`
      INSERT INTO participants_projection (registration_id, participant_id, camp_id, status)
      VALUES (${registrationId}, ${participantId}, ${campId}, ${status})
      ON CONFLICT (registration_id) DO UPDATE SET status = EXCLUDED.status
    `;

    const subject =
      status === "confirmed"
        ? "Your registration is confirmed"
        : "You have been added to the waitlist";

    await sql`
      INSERT INTO notifications (participant_id, subject, body, source_event_id)
      VALUES (
        ${participantId},
        ${subject},
        ${`Camp ${campId}: your registration status is "${status}".`},
        ${event.eventId}
      )
    `;

    await sql`
      INSERT INTO processed_events (event_id, event_type)
      VALUES (${event.eventId}, ${event.eventType})
    `;
  });

  console.log(`[consumer:registrations] ParticipantRegistered ${participantId} (${status})`);
}

async function handleRegistrationCancelled(event: RegistrationCancelledEvent): Promise<void> {
  const { registrationId, participantId } = event.payload;

  await pg.begin(async (sql): Promise<void> => {
    const [seen] = await sql<[SeenRow?]>`
      SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
    `;
    if (seen) return;

    // Mark cancelled so this participant is excluded from future fan-outs.
    await sql`
      UPDATE participants_projection
      SET    status = 'cancelled'
      WHERE  registration_id = ${registrationId}
    `;

    await sql`
      INSERT INTO processed_events (event_id, event_type)
      VALUES (${event.eventId}, ${event.eventType})
    `;
  });

  console.log(`[consumer:registrations] RegistrationCancelled ${participantId} — projection updated`);
}

async function handleWaitlistPromoted(event: WaitlistPromotedEvent): Promise<void> {
  const { registrationId, participantId, campId, previousPosition } = event.payload;

  await pg.begin(async (sql): Promise<void> => {
    const [seen] = await sql<[SeenRow?]>`
      SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
    `;
    if (seen) return;

    await sql`
      UPDATE participants_projection
      SET    status = 'confirmed'
      WHERE  registration_id = ${registrationId}
    `;

    await sql`
      INSERT INTO notifications (participant_id, subject, body, source_event_id)
      VALUES (
        ${participantId},
        ${"A spot opened up — you're confirmed!"},
        ${`Camp ${campId}: you were promoted from waitlist position ${previousPosition} to confirmed.`},
        ${event.eventId}
      )
    `;

    await sql`
      INSERT INTO processed_events (event_id, event_type)
      VALUES (${event.eventId}, ${event.eventType})
    `;
  });

  console.log(`[consumer:registrations] WaitlistPromoted ${participantId} (was #${previousPosition})`);
}

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

async function handleActivityCancelled(event: ActivityCancelledEvent): Promise<void> {
  const { activityId, campId, title, reason } = event.payload;

  const count = await pg.begin(async (sql): Promise<number> => {
    const [seen] = await sql<[SeenRow?]>`
      SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
    `;
    if (seen) return 0;

    // Fan-out to all active participants of this camp.
    const participants = await sql<ParticipantRow[]>`
      SELECT DISTINCT participant_id
      FROM   participants_projection
      WHERE  camp_id = ${campId}
        AND  status != 'cancelled'
    `;

    const subject = `Activity "${title}" has been cancelled`;
    const body = reason
      ? `The activity was cancelled. Reason: ${reason}.`
      : "The activity was cancelled.";

    for (const { participant_id } of participants) {
      await sql`
        INSERT INTO notifications (participant_id, subject, body, source_event_id)
        VALUES (${participant_id}, ${subject}, ${body}, ${event.eventId})
      `;
    }

    await sql`
      INSERT INTO processed_events (event_id, event_type)
      VALUES (${event.eventId}, ${event.eventType})
    `;

    return participants.length;
  });

  console.log(`[consumer:activities] ActivityCancelled ${activityId} → saved ${count} notification(s)`);
}

// ---------------------------------------------------------------------------
// News events — fan-out to all active participants
// ---------------------------------------------------------------------------

async function handleNewsPublished(event: NewsPublishedEvent): Promise<void> {
  const { newsId, title, publishedAt } = event.payload;

  const count = await pg.begin(async (sql): Promise<number> => {
    const [seen] = await sql<[SeenRow?]>`
      SELECT event_id FROM processed_events WHERE event_id = ${event.eventId}
    `;
    if (seen) {
      console.log(`[consumer:news] duplicate event ${event.eventId} — skipping`);
      return 0;
    }

    // All active participants across all camps receive the announcement.
    const participants = await sql<ParticipantRow[]>`
      SELECT DISTINCT participant_id
      FROM   participants_projection
      WHERE  status != 'cancelled'
    `;

    const subject = `New announcement: ${title}`;
    const body = `A new article has been published on ${publishedAt}.`;

    for (const { participant_id } of participants) {
      await sql`
        INSERT INTO notifications (participant_id, subject, body, source_event_id)
        VALUES (${participant_id}, ${subject}, ${body}, ${event.eventId})
      `;
    }

    await sql`
      INSERT INTO processed_events (event_id, event_type)
      VALUES (${event.eventId}, ${event.eventType})
    `;

    return participants.length;
  });

  console.log(`[consumer:news] NewsPublished ${newsId} → saved ${count} notification(s)`);
}
