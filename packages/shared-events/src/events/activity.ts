import type { KafkaEvent } from "../base.js";

export const ACTIVITY_EVENT_TYPES = {
  ACTIVITY_CREATED: "ActivityCreated",
} as const;

export interface ActivityCreatedPayload {
  activityId: string;
  campId: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  capacity: number;
  instructorId?: string;
}

export type ActivityCreatedEvent = KafkaEvent<"ActivityCreated", ActivityCreatedPayload>;

export type ActivityEvent = ActivityCreatedEvent;
