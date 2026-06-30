# ADR-0004: PostgreSQL vs MongoDB

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

CampOS operates on data with strong relational relationships: camp → activities → registrations → participants. We need to choose a primary data store that ensures data integrity, transactionality, and convenient complex queries.

Additionally, the Outbox Pattern (ADR-0005) requires transactional writes of both an event and business data in a single atomic operation — this is a key constraint in the database selection.

## Decision

We choose **PostgreSQL 16** as the sole primary data store.

PostgreSQL provides ACID transactions, foreign keys for relational integrity (camp → activities, registration → participant), complex JOIN queries, and JSONB for semi-structured data (e.g. activity metadata). The outbox table is written in the same transaction as domain data — this cannot be reliably achieved with MongoDB without distributed transactions.

## Consequences

**Positive:**
- ACID transactions — guaranteed integrity under concurrent registrations (race condition on capacity)
- Foreign keys prevent orphaned records
- JSONB allows flexible fields without hard schema migrations
- Row-level locking for safe capacity decrement
- Excellent TypeScript ecosystem support (Drizzle ORM, Prisma, Kysely)

**Negative:**
- Vertical scaling is harder than MongoDB's horizontal sharding
- Schema migrations require care on large tables
- Not suited for storing high-volume unstructured data (logs, events — those go to Kafka)

## Alternatives

**MongoDB** — flexible schema, horizontal sharding. Rejected: lack of reliable multi-document ACID transactions makes a sound Outbox Pattern implementation fragile. The relational nature of the domain maps poorly to a document model.

**CockroachDB** — distributed SQL, PostgreSQL-protocol compatible. Attractive for global scale, but operational complexity is excessive at this stage.

**PlanetScale (MySQL)** — managed, good scalability. Rejected due to the lack of foreign key support in sharding mode and a smaller TypeScript ecosystem.
