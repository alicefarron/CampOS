# ADR-0003: REST vs gRPC

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

CampOS requires an API for two types of interaction:
1. **External API** — mobile and web clients (participants, camp organisers)
2. **Internal API** — synchronous communication between modules/services (when async events are insufficient)

We need to choose a protocol that balances client ergonomics, performance, and maintenance complexity.

## Decision

- **External API**: **REST + JSON** (OpenAPI 3.1)
- **Internal API**: **REST + JSON** (for now), with an option to migrate to gRPC when services are extracted

REST is chosen for both layers due to its universality: browsers, mobile clients, and third-party integrations all work with HTTP/JSON without additional tooling. OpenAPI contracts are generated as a typed package for the client SDK — consistent with the `@campost/shared-events` approach.

gRPC remains in the backlog for internal service-to-service calls if latency becomes a bottleneck.

## Consequences

**Positive:**
- Zero barrier for frontend/mobile developers
- Easy to test with curl, Postman, Insomnia
- OpenAPI → auto-generated client types (openapi-typescript)
- HTTP caching at the CDN/proxy level

**Negative:**
- REST does not enforce a strict contract — discipline via OpenAPI is required
- No built-in streaming (SSE or WebSocket needed separately)
- JSON serialisation is slower than binary protobuf under high load

## Alternatives

**gRPC** — strict contract via protobuf, bidirectional streaming, high performance. Ideal for internal services. Rejected as the primary API due to browser support complexity (requires a gRPC-Web proxy) and a high onboarding cost for new team members.

**GraphQL** — flexible queries, well-suited for complex client screens. Rejected due to field-level authorisation complexity, caching challenges, and excessive complexity for CampOS's CRUD-heavy domains.

**tRPC** — end-to-end type safety without code generation. Tied to a TypeScript full-stack setup. Under consideration for future internal calls if the team stays on a monolith + TypeScript stack.
