import type { KafkaEvent } from "../base.js";

export const ACTIVITY_EVENT_TYPES = {
  ACTIVITY_CREATED: "ActivityCreated",
  ACTIVITY_CANCELLED: "ActivityCancelled",
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

export interface ActivityCancelledPayload {
  activityId: string;
  campId: string;
  title: string;
  cancelledAt: string;
  reason?: string;
}

export type ActivityCreatedEvent = KafkaEvent<"ActivityCreated", ActivityCreatedPayload>;

export type ActivityCancelledEvent = KafkaEvent<"ActivityCancelled", ActivityCancelledPayload>;

export type ActivityEvent = ActivityCreatedEvent | ActivityCancelledEvent;
