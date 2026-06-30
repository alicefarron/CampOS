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
  payload: string;
  attempts: number;
};

/** Reset rows stuck in 'processing' from a previous crash. */
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
  // Lock rows and move to 'processing' atomically
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
        messages: [
          {
            key: extractCampId(row.payload),
            value: row.payload,
          },
        ],
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
      await db
        .update(outboxEvents)
        .set({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts })
        .where(eq(outboxEvents.id, row.id));

      if (attempts >= MAX_ATTEMPTS) {
        console.error(`[outbox] event ${row.id} exceeded ${MAX_ATTEMPTS} attempts → failed`);
      }
    }
  }
}

function extractCampId(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { payload?: { campId?: string }; eventId?: string };
    return parsed.payload?.campId ?? parsed.eventId ?? "unknown";
  } catch {
    return "unknown";
  }
}
