import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Local read model of camps — populated by consuming CampCreated events. */
export const campsProjection = pgTable("camps_projection", {
  id: uuid("id").primaryKey(),
  capacity: integer("capacity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campId: uuid("camp_id").notNull(),
    /** null = camp-level registration; set = activity-level registration */
    activityId: uuid("activity_id"),
    participantId: text("participant_id").notNull(),
    /** confirmed | waitlisted | cancelled */
    status: text("status").notNull(),
    /** null for confirmed registrations */
    waitlistPosition: integer("waitlist_position"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => ({
    campIdIdx: index("registrations_camp_id_idx").on(t.campId),
    participantIdx: index("registrations_participant_id_idx").on(t.participantId),
    // Partial unique indexes are defined in migrate.ts (Drizzle doesn't support WHERE clause on indexes)
  }),
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    topic: text("topic").notNull(),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => ({ statusIdx: index("outbox_events_status_idx").on(t.status) }),
);

/**
 * Kafka consumer idempotency — tracks which eventIds have already been processed.
 * Before processing a message, check if eventId exists here.
 * After processing, insert eventId in the same transaction.
 */
export const processedEvents = pgTable("processed_events", {
  eventId: uuid("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * HTTP idempotency — caches the response for a given Idempotency-Key header.
 * Protects against the "user pressed the button 20 times" scenario.
 *
 * Status flow: processing → done
 * Concurrent requests with the same key:
 *   - First to arrive: INSERT succeeds, processes, updates to 'done'
 *   - Others: INSERT hits conflict → check status → return 409 (processing) or cached (done)
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  /** processing | done */
  status: text("status").notNull().default("processing"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
