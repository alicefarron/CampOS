import type { KafkaEvent } from "../base.js";

export const CAMP_EVENT_TYPES = {
  CAMP_CREATED: "CampCreated",
} as const;

export interface CampCreatedPayload {
  campId: string;
  name: string;
  organizerId: string;
  startDate: string;
  endDate: string;
  capacity: number;
  location: {
    country: string;
    city: string;
    address?: string;
  };
}

export type CampCreatedEvent = KafkaEvent<"CampCreated", CampCreatedPayload>;

export type CampEvent = CampCreatedEvent;
