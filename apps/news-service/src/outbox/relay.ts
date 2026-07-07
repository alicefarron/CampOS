import { eq, inArray } from "drizzle-orm";

import { config } from "../config.js";
import { db, pg } from "../db/client.js";
import { outboxEvents } from "../db/schema.js";
import { getProducer } from "./publisher.js";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

type OutboxRow = {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export async function resetStuckEvents(): Promise<void> {
  const reset = await db
    .update(outboxEvents)
    .set({ status: "pending" })
    .where(eq(outboxEvents.status, "processing"))
    .returning({ id: outboxEvents.id });

  if (reset.length > 0) {
    console.warn(`[outbox] reset ${reset.length} stuck event(s) → pending`);
  }
}

export function startOutboxRelay(): NodeJS.Timeout {
  return setInterval(() => {
    void processBatch().catch((err: unknown) => {
      console.error("[outbox] relay tick error:", err);
    });
  }, config.OUTBOX_POLL_INTERVAL_MS);
}

async function processBatch(): Promise<void> {
  const rows = await pg.begin(async (sql): Promise<OutboxRow[]> => {
    const locked = await sql<OutboxRow[]>`
      SELECT id, topic, payload, attempts
      FROM   outbox_events
      WHERE  status = 'pending'
      ORDER  BY occurred_at ASC
      LIMIT  ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;

    if (locked.length === 0) return [];

    await sql`
      UPDATE outbox_events
      SET    status = 'processing'
      WHERE  id = ANY(${locked.map((r) => r.id)})
    `;

    return locked;
  });

  if (rows.length === 0) return;

  const producer = await getProducer();

  try {
    await producer.sendBatch({
      topicMessages: rows.map((row) => ({
        topic: row.topic,
        messages: [{ key: extractPartitionKey(row.payload), value: JSON.stringify(row.payload) }],
      })),
    });

    await db
      .update(outboxEvents)
      .set({ status: "published", publishedAt: new Date() })
      .where(inArray(outboxEvents.id, rows.map((r) => r.id)));

    console.log(`[outbox] published ${rows.length} event(s)`);
  } catch (err: unknown) {
    console.error("[outbox] batch publish failed, scheduling retry:", err);

    for (const row of rows) {
      const attempts = row.attempts + 1;
      const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";

      await db
        .update(outboxEvents)
        .set({ status: nextStatus, attempts })
        .where(eq(outboxEvents.id, row.id));

      if (nextStatus === "failed") {
        console.error(`[outbox] event ${row.id} exceeded ${MAX_ATTEMPTS} attempts → failed`);
      }
    }
  }
}

function extractPartitionKey(payload: Record<string, unknown>): string {
  const inner = payload.payload as Record<string, unknown> | undefined;
  return (inner?.newsId as string | undefined) ?? (payload.eventId as string | undefined) ?? "unknown";
}
