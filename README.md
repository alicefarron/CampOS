# CampOS

Backend platform for managing outdoor camps: participant registration, activity scheduling, capacity control, and waitlists.

## Architecture

TypeScript monorepo (pnpm workspaces). Two services communicate through Kafka; each owns its database schema.

```
CampOS/
├── apps/
│   ├── camp-service/          # port 3001 — camps & activities
│   └── registration-service/  # port 3002 — registrations & waitlists
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
# 1. Start infrastructure
cp .env.example .env
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Configure services
cp apps/camp-service/.env.example apps/camp-service/.env
cp apps/registration-service/.env.example apps/registration-service/.env

# 4. Run both services (migrations run automatically on startup)
pnpm dev
```

Kafka UI is available at http://localhost:8080.

## Services

### camp-service (`:3001`)

Manages camps and activities. Publishes `CampCreated` and `ActivityCreated` events via the Outbox Pattern.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/camps` | Create a camp |
| `POST` | `/activities` | Create an activity for a camp |
| `GET` | `/activities?campId=<uuid>` | List activities for a camp |

### registration-service (`:3002`)

Handles participant registrations with capacity enforcement and automatic waitlist promotion. Consumes `CampCreated` events to maintain a local `camps_projection` read model.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/registrations` | Register a participant (confirmed or waitlisted) |
| `DELETE` | `/registrations/:id` | Cancel a registration; promotes first waitlisted if a confirmed slot is freed |

**Idempotency:** include an `Idempotency-Key: <uuid>` header on `POST /registrations` to safely retry without duplicate registrations.

## Kafka events

All event contracts live in `packages/shared-events/src/`.

| Event | Topic | Published by |
|-------|-------|--------------|
| `CampCreated` | `camps` | camp-service |
| `ActivityCreated` | `activities` | camp-service |
| `ParticipantRegistered` | `registrations` | registration-service |
| `RegistrationCancelled` | `registrations` | registration-service |
| `WaitlistPromoted` | `registrations` | registration-service |

## Key design decisions

| ADR | Decision |
|-----|----------|
| [ADR-0001](docs/adr/ADR-0001-kafka-vs-rabbitmq.md) | Kafka (KRaft) for event streaming |
| [ADR-0002](docs/adr/ADR-0002-microservices-vs-monolith.md) | Modular monolith, microservices-ready |
| [ADR-0003](docs/adr/ADR-0003-rest-vs-grpc.md) | REST + JSON (OpenAPI 3.1) |
| [ADR-0004](docs/adr/ADR-0004-postgres-vs-mongodb.md) | PostgreSQL 16 |
| [ADR-0005](docs/adr/ADR-0005-outbox-pattern.md) | Outbox Pattern for reliable event publishing |

Notable patterns in registration-service:

- **Deadlock-free locking** — always acquire camp lock before registration lock.
- **Three-layer duplicate protection** — partial unique index (DB), `processed_events` (Kafka idempotency), `idempotency_keys` (HTTP idempotency).
- **Outbox relay** — `FOR UPDATE SKIP LOCKED` polling with `resetStuckEvents()` on startup.

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

- [ ] Notification service (email on registration / waitlist promotion)
- [ ] Authentication / JWT middleware
- [ ] `GET /registrations` endpoint
- [ ] Versioned migrations (drizzle-kit)
- [ ] Integration tests
- [ ] CI/CD pipeline
- [ ] Frontend / Web App
