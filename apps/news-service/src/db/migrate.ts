import { pg } from "./client.js";

export async function runMigrations(): Promise<void> {
  await pg`
    CREATE TABLE IF NOT EXISTS news (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title        TEXT        NOT NULL,
      body         TEXT        NOT NULL,
      author_id    TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
