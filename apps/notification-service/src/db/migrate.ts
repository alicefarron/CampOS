import { pg } from "./client.js";

export async function runMigrations(): Promise<void> {
  // Local read model: who is registered and where.
  // Populated by consuming ParticipantRegistered / RegistrationCancelled /
  // WaitlistPromoted events. Used to fan out notifications on NewsPublished
  // and ActivityCancelled without calling other services.
  await pg`
    CREATE TABLE IF NOT EXISTS participants_projection (
      registration_id UUID PRIMARY KEY,
      participant_id  TEXT        NOT NULL,
      camp_id         UUID        NOT NULL,
      status          TEXT        NOT NULL
    )
  `;

  await pg`
    CREATE INDEX IF NOT EXISTS participants_projection_status_idx
    ON participants_projection(status)
  `;

  await pg`
    CREATE TABLE IF NOT EXISTS notifications (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      participant_id  TEXT        NOT NULL,
      subject         TEXT        NOT NULL,
      body            TEXT        NOT NULL,
      source_event_id TEXT        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Prevents duplicate notifications if Kafka redelivers an event.
  await pg`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id     TEXT        PRIMARY KEY,
      event_type   TEXT        NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
