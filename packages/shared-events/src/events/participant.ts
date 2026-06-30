import type { KafkaEvent } from "../base.js";

export const PARTICIPANT_EVENT_TYPES = {
  PARTICIPANT_REGISTERED: "ParticipantRegistered",
  REGISTRATION_CANCELLED: "RegistrationCancelled",
  WAITLIST_PROMOTED: "WaitlistPromoted",
} as const;

export interface ParticipantRegisteredPayload {
  registrationId: string;
  campId: string;
  participantId: string;
  registeredAt: string;
  /** Whether the participant got a confirmed spot or was placed on the waitlist */
  status: "confirmed" | "waitlisted";
}

export interface RegistrationCancelledPayload {
  registrationId: string;
  campId: string;
  participantId: string;
  cancelledAt: string;
  reason?: string;
}

export interface WaitlistPromotedPayload {
  registrationId: string;
  campId: string;
  participantId: string;
  promotedAt: string;
  /** Position on the waitlist before promotion */
  previousPosition: number;
}

export type ParticipantRegisteredEvent = KafkaEvent<
  "ParticipantRegistered",
  ParticipantRegisteredPayload
>;

export type RegistrationCancelledEvent = KafkaEvent<
  "RegistrationCancelled",
  RegistrationCancelledPayload
>;

export type WaitlistPromotedEvent = KafkaEvent<"WaitlistPromoted", WaitlistPromotedPayload>;

export type RegistrationEvent =
  | ParticipantRegisteredEvent
  | RegistrationCancelledEvent
  | WaitlistPromotedEvent;
