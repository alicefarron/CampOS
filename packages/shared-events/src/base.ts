export interface KafkaEvent<TType extends string, TPayload> {
  /** Unique event ID (UUID v4) */
  eventId: string;
  /** Event type discriminator */
  eventType: TType;
  /** Schema version — increment on breaking payload changes */
  version: number;
  /** ISO 8601 UTC timestamp of when the event occurred */
  occurredAt: string;
  payload: TPayload;
}

/** Kafka topic names */
export const TOPICS = {
  CAMPS: "camps",
  ACTIVITIES: "activities",
  REGISTRATIONS: "registrations",
} as const;

export type Topic = (typeof TOPICS)[keyof typeof TOPICS];
