import { pg } from "./client.js";

export async function runMigrations(): Promise<void> {
  await pg`
    CREATE TABLE IF NOT EXISTS camps (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT        NOT NULL,
      organiser_id  TEXT        NOT NULL,
      start_date    TEXT        NOT NULL,
      end_date      TEXT        NOT NULL,
      capacity      INTEGER     NOT NULL,
      location      JSONB       NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await pg`
    CREATE TABLE IF NOT EXISTS activities (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      camp_id          UUID        NOT NULL REFERENCES camps(id),
      title            TEXT        NOT NULL,
      scheduled_at     TEXT        NOT NULL,
      duration_minutes INTEGER     NOT NULL,
      capacity         INTEGER     NOT NULL,
      instructor_id    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await pg`
    CREATE INDEX IF NOT EXISTS activities_camp_id_idx ON activities(camp_id)
  `;

  await pg`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type   TEXT        NOT NULL,
      topic        TEXT        NOT NULL,
      payload      JSONB       NOT NULL,
      occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status       TEXT        NOT NULL DEFAULT 'pending',
      published_at TIMESTAMPTZ,
      attempts     INTEGER     NOT NULL DEFAULT 0
    )
  `;

  await pg`
    CREATE INDEX IF NOT EXISTS outbox_events_status_idx ON outbox_events(status)
  `;
}
