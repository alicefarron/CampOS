# ADR-0005: Outbox Pattern for Reliable Kafka Event Publishing

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

When persisting domain data to PostgreSQL we also need to publish an event to Kafka (e.g. `ParticipantRegistered`). The naive approach — save a record to the DB, then send a message to Kafka — creates a consistency window: if the process crashes between the two operations, the event is either lost or duplicated.

Requirements:
- Domain record and event are published atomically (both or neither)
- Event ordering within a single `campId` is preserved
- The service must survive restarts without losing events

## Decision

We implement the **Transactional Outbox Pattern**.

For every domain operation, within a single PostgreSQL transaction, we write:
1. Domain data (e.g. a row in `registrations`)
2. A row in the `outbox_events` table with status `pending`

A dedicated **Relay process** (polling or Debezium CDC) reads `pending` rows from `outbox_events` and publishes them to Kafka. After a successful publish the status is updated to `published`.

```sql
CREATE TABLE outbox_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'pending',
  published_at TIMESTAMPTZ,
  attempts    INT NOT NULL DEFAULT 0
);
```

The relay uses `SELECT ... FOR UPDATE SKIP LOCKED` for safe parallel processing.

## Consequences

**Positive:**
- Atomicity: business data and the event are either saved together or rolled back together
- Crash resilience: the relay will re-read `pending` events after a restart
- At-least-once delivery — Kafka consumers must be idempotent (deduplicate by `eventId`)
- Publish order matches transaction order

**Negative:**
- An extra table and relay process increase operational complexity
- At-least-once means possible duplicates — all consumers must deduplicate by `eventId`
- Polling relay adds latency (100–500 ms); CDC via Debezium reduces this to single-digit ms but requires WAL configuration

## Alternatives

**Dual write without outbox** — write to the DB and publish to Kafka independently. Rejected: does not guarantee consistency on a crash between the two operations.

**Saga (choreography)** — each service reacts to the previous service's event. Does not solve the problem of atomically publishing the initial event — an outbox is still needed at the entry point.

**Debezium CDC** — reads the PostgreSQL WAL and publishes to Kafka without polling. Lower latency, but requires replication slot configuration and a separate Kafka Connect cluster. Considered as an upgrade path for the relay process under higher load.

**Event Sourcing** — store only events, with no separate "current state" table. Fundamentally changes the data model; rejected as excessive at this stage.
