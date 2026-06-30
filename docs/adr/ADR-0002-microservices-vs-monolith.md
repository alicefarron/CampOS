# ADR-0002: Microservices vs Monolith

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

At the start of CampOS development we need to choose an architectural style. The system spans several domains: camp management, activity scheduling, participant registration, notifications, and analytics. The team is small and domain boundaries are still being established.

Key factors:
- Speed of early delivery matters more than perfect decomposition
- Domain boundaries are not yet settled
- The ability to extract high-load parts later is required

## Decision

We choose a **Modular Monolith** with a gradual migration to microservices as the system grows.

The monolith is split into modules with explicit boundaries (camps, activities, registrations, notifications) — each module encapsulates its own database schema and never accesses another module's tables directly. Cross-module communication uses internal events (the same `shared-events` contract), which simplifies future extraction into separate services.

pnpm workspaces allow each module to live under `apps/` as an independent deployable artifact without splitting the repository.

## Consequences

**Positive:**
- Fast start: a single `docker compose up`, no network overhead between services
- Single deployment unit in the early stages
- Refactoring of overlapping concepts is easier inside a monolith
- Explicit module boundaries make future decomposition straightforward

**Negative:**
- Risk of boundary violations as the team grows (import linters needed)
- Individual parts cannot be scaled independently until extracted into services
- The entire application is deployed when a single module changes

## Alternatives

**Microservices from day one** — each domain as a separate service. Rejected due to high infrastructure overhead (service discovery, tracing, distributed transactions) before domain boundaries are stable.

**Monolith without modular boundaries** — fast to start but turns into a "big ball of mud". Rejected because it leaves no clean path to decomposition without painful refactoring.
