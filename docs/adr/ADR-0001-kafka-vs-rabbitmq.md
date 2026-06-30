# ADR-0001: Kafka vs RabbitMQ

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

CampOS uses asynchronous messaging between services for domain events (participant registrations, camp creation, waitlist promotions, etc.). We need to choose a message broker that provides reliable delivery, event replay, and horizontal scalability.

Key requirements:
- Event Sourcing / replay from an arbitrary offset
- Multiple independent consumer groups (notifications, analytics, reports)
- Guaranteed message ordering within a single camp or participant
- Event retention for audit purposes

## Decision

We choose **Apache Kafka** (Confluent Platform, KRaft mode — no Zookeeper).

Kafka's log-based storage allows any new service to replay the full event history from the beginning of a topic. Partitioning by `campId` guarantees event ordering within a single camp. Consumer groups allow independent processing of the same events by different services without duplicating queues.

## Consequences

**Positive:**
- Event replay out of the box — new services can read the full history
- Horizontal scalability via partitions
- High throughput (millions of events/sec)
- Long-term retention as the source of truth for analytics

**Negative:**
- Higher learning curve compared to RabbitMQ
- Kafka is not suitable for RPC patterns (request/reply)
- More complex local testing (mitigated by `docker-compose`)
- No native dead-letter queue — requires a custom implementation

## Alternatives

**RabbitMQ** — a classic message broker with rich routing (exchanges, bindings). Simpler to operate, well-suited for task queues and RPC. Rejected due to the lack of log retention and the inability for consumers to replay events.

**AWS SQS/SNS** — managed solution that reduces operational overhead. Rejected due to AWS vendor lock-in and retention limitations (14 days for SQS).

**NATS JetStream** — lightweight broker with persistence. Considered as an alternative, but its tooling ecosystem (Kafka UI, connectors) is significantly smaller.
