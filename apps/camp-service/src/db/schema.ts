import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const camps = pgTable("camps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organiserId: text("organiser_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  capacity: integer("capacity").notNull(),
  location: jsonb("location").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campId: uuid("camp_id")
      .notNull()
      .references(() => camps.id),
    title: text("title").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    capacity: integer("capacity").notNull(),
    instructorId: text("instructor_id"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ campIdIdx: index("activities_camp_id_idx").on(t.campId) }),
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("pending"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => ({ statusIdx: index("outbox_events_status_idx").on(t.status) }),
);
