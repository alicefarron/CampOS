# CampOS

Backend platform for managing outdoor camps: participant registration, activity scheduling, capacity control, waitlists, and participant notifications.

## Architecture

TypeScript monorepo (pnpm workspaces). Services communicate through Kafka; each owns its database schema.

```
CampOS/
├── apps/
│   ├── camp-service/          # port 3001 — camps & activities
│   ├── registration-service/  # port 3002 — registrations & waitlists
│   ├── news-service/          # port 3003 — news articles
│   └── notification-service/  # port 3004 — notification fan-out & delivery
├── packages/
│   ├── shared-events/         # Kafka event contracts (source of truth)
│   ├── tsconfig/              # base / app / library / react-library
│   ├── eslint-config/
│   └── prettier-config/
└── docs/
    ├── adr/                   # Architecture Decision Records
    └── diagrams/              # C4 diagrams (PlantUML)
```

**Infrastructure:** PostgreSQL 16, Redis 7, Kafka (KRaft), Kafka UI — all in `docker-compose.yml`.

**Stack per service:** Fastify 4, Drizzle ORM, postgres.js, KafkaJS, Zod, tsx.

## Prerequisites

- Node.js 20+
- pnpm 9
- Docker + Docker Compose

## Getting started

```bash
# 1. Start infrastructure (postgres, kafka, redis, kafka-ui)
cp .env.example .env
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure services
cp apps/camp-service/.env.example         apps/camp-service/.env
cp apps/registration-service/.env.example apps/registration-service/.env
cp apps/news-service/.env.example         apps/news-service/.env
cp apps/notification-service/.env.example apps/notification-service/.env

# 4. Run all services (migrations run automatically on startup)
pnpm dev
```

Kafka UI is available at http://localhost:8080.

Each service exposes a Swagger UI at `/swagger` (e.g. http://localhost:3001/swagger).

## Services

### camp-service (`:3001`)

Manages camps and activities. Publishes events via the Outbox Pattern.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/camps` | Create a camp |
| `POST` | `/activities` | Create an activity |
| `GET` | `/activities?campId=<uuid>` | List activities |
| `DELETE` | `/activities/:id` | Cancel an activity; triggers registration cancellation Saga |

### registration-service (`:3002`)

Handles participant registrations with capacity enforcement and automatic waitlist promotion. Consumes `CampCreated` and `ActivityCancelled` events.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/registrations?campId=&participantId=` | List registrations |
| `POST` | `/registrations` | Register a participant (confirmed or waitlisted) |
| `DELETE` | `/registrations/:id` | Cancel; promotes first waitlisted if a confirmed slot is freed |

**Idempotency:** include an `Idempotency-Key: <uuid>` header on `POST /registrations` to safely retry without duplicate registrations.

**Race condition protection:** camp-level `FOR UPDATE` lock serialises all writes per camp; partial unique index is a DB-level safety net.

### news-service (`:3003`)

Manages news articles. Publishing an article (status `published`) emits `NewsPublished` via the Outbox.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/news` | Create an article (`draft` or `published`) |
| `GET` | `/news?status=` | List articles |
| `PATCH` | `/news/:id` | Update; transitions to `published` emit the event |

### notification-service (`:3004`)

Consumes domain events and writes notifications to a local `notifications` table. Fan-out logic:

| Event | Recipients |
|-------|-----------|
| `ParticipantRegistered` | the registered participant |
| `WaitlistPromoted` | the promoted participant |
| `RegistrationCancelled` | projection update only |
| `ActivityCancelled` | all active participants of the camp |
| `NewsPublished` | all active participants across all camps |

Failed handlers are retried 3 times (exponential back-off) then forwarded to `notification-events-dlq`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications?participantId=` | Read stored notifications |

## Kafka events

All event contracts live in `packages/shared-events/src/`.

| Event | Topic | Published by |
|-------|-------|--------------|
| `CampCreated` | `camps` | camp-service |
| `ActivityCreated` | `activities` | camp-service |
| `ActivityCancelled` | `activities` | camp-service |
| `ParticipantRegistered` | `registrations` | registration-service |
| `RegistrationCancelled` | `registrations` | registration-service |
| `WaitlistPromoted` | `registrations` | registration-service |
| `NewsPublished` | `news` | news-service |

## Key design decisions

| ADR | Decision |
|-----|----------|
| [ADR-0001](docs/adr/ADR-0001-kafka-vs-rabbitmq.md) | Kafka (KRaft) for event streaming |
| [ADR-0002](docs/adr/ADR-0002-microservices-vs-monolith.md) | Modular monolith, microservices-ready |
| [ADR-0003](docs/adr/ADR-0003-rest-vs-grpc.md) | REST + JSON (OpenAPI 3.1) |
| [ADR-0004](docs/adr/ADR-0004-postgres-vs-mongodb.md) | PostgreSQL 16 |
| [ADR-0005](docs/adr/ADR-0005-outbox-pattern.md) | Outbox Pattern for reliable event publishing |

Notable patterns:

- **Deadlock-free locking** — camp lock always acquired before registration lock.
- **Three-layer duplicate protection** — partial unique index (DB), `processed_events` (Kafka idempotency), `idempotency_keys` (HTTP idempotency).
- **Outbox relay** — `FOR UPDATE SKIP LOCKED` polling with `resetStuckEvents()` on startup.
- **Activity cancellation Saga** — `ActivityCancelled` triggers registration-service to cancel all active registrations and emit `RegistrationCancelled` per participant.
- **DLQ** — notification-service retries handlers 3× then forwards failed messages to `notification-events-dlq`.

## Development scripts

```bash
pnpm build        # build all packages and apps
pnpm dev          # run all services in parallel (watch mode)
pnpm typecheck    # TypeScript check across the monorepo
pnpm lint         # ESLint
pnpm lint:fix     # ESLint with auto-fix
pnpm format       # Prettier write
pnpm format:check # Prettier check
pnpm clean        # remove all build artifacts and node_modules
```

## Roadmap

- [x] camp-service — camps & activities CRUD, Outbox, Kafka
- [x] registration-service — registrations, waitlist, idempotency, race condition protection
- [x] news-service — articles CRUD, publish flow, Outbox
- [x] notification-service — event consumer, fan-out, DLQ, HTTP read endpoint
- [x] Activity cancellation Saga (registration-service consumes `ActivityCancelled`)
- [x] OpenAPI / Swagger UI on every service
- [x] Full docker-compose (all services + per-service DB init)
- [ ] Authentication / JWT middleware
- [ ] Versioned migrations (drizzle-kit)
- [ ] Actual email / SMS delivery in notification-service
- [ ] Integration tests
- [ ] CI/CD pipeline
- [ ] Frontend / Web App
