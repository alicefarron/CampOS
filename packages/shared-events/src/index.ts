export type { KafkaEvent, Topic } from "./base.js";
export { TOPICS } from "./base.js";

export type { CampCreatedPayload, CampCreatedEvent, CampEvent } from "./events/camp.js";
export { CAMP_EVENT_TYPES } from "./events/camp.js";

export type {
  ActivityCreatedPayload,
  ActivityCreatedEvent,
  ActivityEvent,
} from "./events/activity.js";
export { ACTIVITY_EVENT_TYPES } from "./events/activity.js";

export type {
  ParticipantRegisteredPayload,
  ParticipantRegisteredEvent,
  RegistrationCancelledPayload,
  RegistrationCancelledEvent,
  WaitlistPromotedPayload,
  WaitlistPromotedEvent,
  RegistrationEvent,
} from "./events/participant.js";
export { PARTICIPANT_EVENT_TYPES } from "./events/participant.js";

/** Union of all domain events */
export type { CampEvent as CampEvents } from "./events/camp.js";
export type { ActivityEvent as ActivityEvents } from "./events/activity.js";

import type { CampEvent } from "./events/camp.js";
import type { ActivityEvent } from "./events/activity.js";
import type { RegistrationEvent } from "./events/participant.js";

export type DomainEvent = CampEvent | ActivityEvent | RegistrationEvent;
