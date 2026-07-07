# HOMI v3

The operating system for shared living.
Full product and system spec: [HOMI_V3.md](./HOMI_V3.md).

## Repository layout

```
apps/api        NestJS API service (modular monolith: identity, houses, ledger, ...)
apps/worker     BullMQ worker (recurring bills, reminders, digests)
packages/db     Drizzle schema, migrations, and DB client
packages/domain Pure domain logic (split math, balances) - no I/O, heavily tested
docs/agile      Product backlog, sprint plans, definition of done
```

## Getting started

Requirements: Node >= 22, Docker (for local Postgres/Redis/MinIO).

```sh
npm install
docker compose up -d          # Postgres :5432, Redis :6379, MinIO :9000
cp .env.example .env
npm run db:migrate            # apply Drizzle migrations
npm run dev:api               # API on :3000
```

## Commands

```sh
npm run typecheck             # tsc across all workspaces
npm run lint                  # eslint
npm test                      # unit tests (pure logic, no DB needed)
npm run test:integration      # integration tests (needs DATABASE_URL)
npm run build                 # compile all workspaces
```

## Engineering rules (non-negotiable, from the spec)

- Money is integer cents. All splits must sum exactly to the total (enforced in the DB transaction).
- Money rows are never hard-deleted or silently edited; revisions + activity events always.
- Idempotency keys on every money mutation; retries can never double-post.
- Clients render state; the server computes it. One balance function for every surface.
- Ledger code does not merge without tests.
