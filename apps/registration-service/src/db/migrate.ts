import { pg } from "./client.js";

export async function runMigrations(): Promise<void> {
  // ── Core tables ──────────────────────────────────────────────────────────

  await pg`
    CREATE TABLE IF NOT EXISTS camps_projection (
      id         UUID        PRIMARY KEY,
      capacity   INTEGER     NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await pg`
    CREATE TABLE IF NOT EXISTS registrations (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      camp_id           UUID        NOT NULL,
      activity_id       UUID,
      participant_id    TEXT        NOT NULL,
      status            TEXT        NOT NULL,
      waitlist_position INTEGER,
      registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled_at      TIMESTAMPTZ
    )
  `;

  await pg`CREATE INDEX IF NOT EXISTS registrations_camp_id_idx ON registrations(camp_id)`;
  await pg`CREATE INDEX IF NOT EXISTS registrations_participant_id_idx ON registrations(participant_id)`;

  // ── Partial unique indexes ────────────────────────────────────────────────
  //
  // Cancelled registrations are excluded so a participant can re-register
  // after cancelling. Standard UNIQUE constraints cannot express this —
  // partial indexes are the correct PostgreSQL mechanism here.
  //
  // Enforces at the DB level what the application already checks programmatically,
  // making duplicate defence resilient against concurrent requests and bugs.

  await pg`
    CREATE UNIQUE INDEX IF NOT EXISTS registrations_unique_active_activity
    ON registrations(participant_id, activity_id)
    WHERE status != 'cancelled'
      AND activity_id IS NOT NULL
  `;

  await pg`
    CREATE UNIQUE INDEX IF NOT EXISTS registrations_unique_active_camp
    ON registrations(participant_id, camp_id)
    WHERE status != 'cancelled'
      AND activity_id IS NULL
  `;

  // ── Outbox ───────────────────────────────────────────────────────────────

  await pg`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type   TEXT        NOT NULL,
      topic        TEXT        NOT NULL,
      payload      TEXT        NOT NULL,
      occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status       TEXT        NOT NULL DEFAULT 'pending',
      published_at TIMESTAMPTZ,
      attempts     INTEGER     NOT NULL DEFAULT 0
    )
  `;

  await pg`CREATE INDEX IF NOT EXISTS outbox_events_status_idx ON outbox_events(status)`;

  // ── Idempotency: Kafka consumer ───────────────────────────────────────────
  //
  // Stores eventIds of messages that have already been processed.
  // Checked inside the same transaction as the business write.

  await pg`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id     UUID        PRIMARY KEY,
      event_type   TEXT        NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Idempotency: HTTP requests ────────────────────────────────────────────
  //
  // Caches HTTP responses by Idempotency-Key header value.
  // Protects against clients retrying the same request multiple times.

  await pg`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key             TEXT        PRIMARY KEY,
      status          TEXT        NOT NULL DEFAULT 'processing',
      response_status INTEGER,
      response_body   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
