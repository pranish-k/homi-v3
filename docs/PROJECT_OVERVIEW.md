# HOMI v3 - project overview

A single reference sheet for describing this project outside the repo (resume, portfolio, interviews).
Everything here is drawn from the repo as of 2026-07-27 (`main` @ `0764755`, latest tag `v0.6.0-sprint6`, Sprint 7 closed).

---

## 1. One-line description

HOMI is a mobile-first "operating system for shared living": a production-deployed, financially-correct shared-expense ledger for roommate households, built as a TypeScript monorepo with a NestJS API, a background worker, and an Expo React Native client on Google Cloud Run.

## 2. Short paragraph (portfolio / resume header)

HOMI v3 is a solo-built, full-stack product that turns the money conflicts of shared living into a system: room-weighted rent splits, recurring bills that auto-post in the house timezone, server-computed balances, and single-sided settlements with a dispute window.
It is built as an npm-workspaces TypeScript monorepo (NestJS API, BullMQ-style worker, Drizzle/Postgres, Redis, Expo React Native) and runs live on Google Cloud Run with CI/CD, staging and production environments, Workload Identity Federation, Secret Manager, Sentry, and an iOS build on TestFlight.
The engineering is deliberately ledger-grade: integer-cent money, property-tested split math, idempotency keys on every money mutation, transactional writes, and immutable revisions instead of edits.

## 3. Problem and product thesis

Shared households have no shared system of record, so money, chores, and agreements run on memory and awkward conversations.
The spec maps 24 real-life pain points (money, labor, supplies, communication, lifecycle) and answers them with five product pillars: the Ledger, Fair Chores, Supplies and Shared Stuff, House Norms and the Board, and Lifecycle Flows.
The design test for every feature: does it remove an awkward human conversation or prevent a fight before it starts?

Release 1 (the committed scope, and what exists today) is the Money Core.
R2-R4 are an explicit hypothesis backlog, not a promise, so breadth never gets built before the first loop retains.

---

## 4. Tech stack

**Language and tooling**
- TypeScript 5.8 (strict), Node.js 22
- npm workspaces monorepo (`apps/*`, `packages/*`)
- ESLint 9 + typescript-eslint, `tsc` typecheck across all workspaces
- Vitest (unit + integration), fast-check for property-based testing

**Backend**
- NestJS 10 (modular monolith: identity, houses, ledger, activity, realtime, ratelimit, health, email, observability)
- Drizzle ORM + drizzle-kit migrations against PostgreSQL 16
- Redis (ioredis) for pub/sub fan-out, rate limits, and job coordination; Upstash in cloud environments
- `ws` WebSocket gateway for realtime cache-invalidation hints
- Better Auth 1.6.23 (magic link, email OTP, Expo plugin) for passwordless sessions
- Resend for transactional email from a verified domain
- Separate worker service for recurring bill posting, idempotency-key pruning, and scheduled ticks

**Mobile client**
- Expo SDK 57 + expo-router, React Native 0.86, React 19, TypeScript strict
- expo-secure-store for session persistence, expo-linking deep links (`homi://auth/verify`, `homi://join`)
- EAS Build + EAS Submit; distributed through the TestFlight internal track

**Infrastructure and operations**
- Google Cloud Run (API service + worker service), Cloud SQL for Postgres 16, Cloud Scheduler (per-minute tick, hourly prune)
- Artifact Registry, Secret Manager, Workload Identity Federation (keyless GitHub Actions to GCP auth)
- GitHub Actions CI: typecheck, lint, unit tests, integration tests against ephemeral Postgres + Redis services, migration drift check, migration dry-run, Docker build
- CD: pushes to `main` auto-deploy staging; version tags deploy production; migrations run through the Cloud SQL Auth Proxy pre-traffic, gated on `/readyz`
- Sentry error capture with release tagging (configured by presence, never fails boot)
- Docker multi-stage image shared by API and worker

**Process**
- Scrum-style delivery: product backlog with Fibonacci points, sprint plans, a written Definition of Done, sprint reviews and retrospectives (`docs/agile/`)
- Trunk-based development, short-lived branches, PRs merged only on green CI
- A standing multi-agent code review gate before every sprint tag

---

## 5. Architecture at a glance

```
Expo React Native (iOS, TestFlight)
        │  HTTPS REST + JSON            │  WebSocket (realtime hints)
        ▼                               ▼
NestJS API on Cloud Run  ◄── Redis (pub/sub, rate limits) ──►  Worker on Cloud Run
        │                                                       ▲ Cloud Scheduler
        ▼                                                       │ (tick 1m, prune 1h)
PostgreSQL 16 on Cloud SQL (per-house isolation, every table carries house_id)
```

Repository layout:

```
apps/api        NestJS API service (modular monolith)
apps/worker     Scheduled/queued background jobs
apps/mobile     Expo React Native client
packages/db     Drizzle schema, migrations, DB client
packages/domain Pure split/balance math, no I/O, property-tested
packages/ledger Transactional posting core shared by API and worker
docs/agile      Backlog, sprint plans, Definition of Done
docs/infra      GCP infrastructure reference
```

Data model (15 tables): `users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `houses`, `rooms`, `house_members`, `invites`, `expenses`, `expense_splits`, `expense_revisions`, `bill_templates`, `payments`, `idempotency_keys`, `activity_events`.

---

## 6. Non-negotiable engineering invariants

These are the parts worth talking about in an interview.

1. **Money is integer cents.** Splits must sum exactly to the total, enforced inside the database transaction, never in the client.
2. **One balance function.** The server computes state; clients only render it, so no two surfaces can disagree.
3. **Idempotency keys on every money mutation.** A retry can never double-post; keys are pruned by a worker job after a retention window.
4. **Money rows are never hard-deleted or silently edited.** Edits create revision snapshots plus activity events, so history is auditable.
5. **Snapshot-consistent reads.** Balances read expenses and payments in one consistent snapshot rather than two statements.
6. **The house is the atomic unit.** No feature queries across houses, which makes shard-by-house a mechanical future move.
7. **Production refuses to boot** without `REDIS_URL`, `BETTER_AUTH_SECRET`, and `RESEND_API_KEY`.
8. **Ledger code does not merge without tests.**

---

## 7. What is built and shipped so far

Delivered across seven sprints (Sprint 1 through Sprint 7, 2026-07-07 to 2026-07-25), roughly 9,300 lines of first-party TypeScript, 7 migrations, and 20 test files.

**Platform and infrastructure**
- Monorepo scaffold with lint, typecheck, unit and integration test wiring (HOMI-1)
- CI on every push and PR: typecheck, lint, unit tests, integration tests on ephemeral Postgres and Redis, migration drift check, migration dry-run, Docker build (HOMI-4)
- Cloud Run deploy pipeline: `main` to staging automatically, tags to production, keyless WIF auth, image push, pre-traffic migrations via the Cloud SQL Auth Proxy, `/readyz` gate (HOMI-14)
- First production deploy shipped on tag `v0.6.0-sprint6`: `homi-api` and `homi-worker` live, migrations applied, Cloud Scheduler jobs verified in prod
- Sentry error capture and release tagging in API and worker; API reports only 5xx, worker reports tick and prune failures (HOMI-15a)
- Health and readiness probes that verify real DB connectivity so a wedged pool cannot report healthy (HOMI-27)
- Rate limiting on auth and invite endpoints, since magic-link send is an unauthenticated email loop (HOMI-24)

**Identity and houses**
- Passwordless auth via Better Auth: email magic link plus an email OTP code path, persistent sessions (HOMI-2, HOMI-31)
- Real transactional email delivery through Resend from a verified domain, with a logged-link seam kept for dev (HOMI-21)
- Create a house with timezone and currency, creator becomes admin (HOMI-3)
- Hashed invite links with a preview endpoint and an interstitial page, accepted explicitly by the invitee (HOMI-8, HOMI-32)
- Placeholder roommates: log expenses against someone who has not joined yet, and let them claim that entire history in a single transaction (HOMI-9)
- Rooms with weight basis points summing to 10000, including couples sharing one room's weight (HOMI-10, HOMI-23)
- Name capture at signup plus per-house display names, so no surface shows a nameless member (HOMI-28)

**The ledger**
- Pure, property-tested split math: equal, exact, percentage, and room-weighted modes, integer cents, deterministic remainder assignment (HOMI-5)
- Expense creation in any split mode, idempotent and transactional (HOMI-6)
- Server-computed per-person balances from a single shared function (HOMI-7)
- Settlement payments, single-sided with a 72-hour dispute window (HOMI-11)
- Expense edits that keep the prior version as a revision and notify the house (HOMI-12)
- Recurring bills that auto-post on the due date in the house timezone, exactly once per period, with hazard-first schedule math (HOMI-13)
- Unified cursor-paginated ledger of expenses and payments (HOMI-16)
- Recipient-only dispute resolution: the protected party holds the pen (HOMI-29)

**Engagement surfaces**
- WebSocket realtime feed updates with Redis fan-out, used strictly as cache-invalidation hints (HOMI-17)
- A HOME snapshot endpoint returning members, balances, action items, and feed head in one call (HOMI-20)

**Mobile client**
- Expo app scaffold building through EAS and installing from the TestFlight internal track, App Store Connect app created, API key stored for non-interactive builds (HOMI-30)
- Sign-in on the phone with a magic link or an emailed OTP code, session persisted in SecureStore and surviving app relaunch; the magic link routes through an API interstitial so the session lands in the app rather than in Safari (HOMI-31)
- Create a house, or preview and join one by tapping an invite link, with the house, inviter, and any claimed placeholder named before the join button (HOMI-32)

**Quality practice**
- Test suites at Sprint 7 close: 34 unit tests, 81 API integration tests, plus the worker suite, all green
- A code review gate at every sprint close that has caught real bugs every single run, including cross-user idempotency replay leaks, currency mixing, a WebSocket upgrade-socket crash, and a shutdown deadlock
- Retro-driven process changes, for example "hazard-first design needs hazard-first tests, branch by branch," adopted after Sprint 5's bugs turned up in designed-but-untested rare branches

---

## 8. What is next

**Immediate (finishing TestFlight v1, epic E6)**
- HOMI-33: the HOME tab rendering balances, members, and the feed head from the snapshot endpoint, refreshed by realtime hints
- HOMI-34: add an expense (equal or exact) in under 15 seconds, which is the R1 release gate
- HOMI-35: settle up in one tap with Venmo, Zelle, and Cash App deep links
- The first real TestFlight build of the full expense loop, which is also the first device test of both deep links (`homi://auth/verify` and `homi://join`)
- Blocker on the critical path: visual direction for the HOME and add-expense screens, since every remaining story is UI work behind that decision

**Remaining R1 backlog**
- HOMI-18: private stale-debt nudges to debtors, so creditors never have to ask
- HOMI-19: weekly digest of house balances and activity
- HOMI-15: OpenTelemetry plus p95 and queue-lag dashboards

**Known debt to clear**
- DMARC on the sending domain before outside testers
- Split the shared Upstash Redis into separate staging and production instances before real production traffic
- Dockerfile nested-`node_modules` band-aid (needs a Docker-capable environment to fix safely)
- Two-room merge case when a roomed member claims a roomed placeholder
- Upstream Expo/Xcode 26 incompatibility that broke local iOS builds; EAS cloud builds are unaffected

**Release gates before R2**
- Median add-expense under 15 seconds
- Invited-roommate join rate above 60 percent
- Zero balance-math bug reports

**Roadmap beyond R1 (hypothesis backlog, sequenced but not promised)**
- R2, Fair Chores: effort-weighted chores, server-side rotations that roll missed turns forward, private-first contribution stats driving nudges, written definitions of done
- R3, The House Layer: House Norms sheet with change tracking, the Board with read receipts, a staples list with a home-screen widget, a maintenance log
- R4, Lifecycle: guided move-in flow, shared asset registry with human-priced buyouts, deposit tracking, renegotiation prompts, and a move-out settlement report

**Business model (planned)**
Free core loop for every pillar, so no roommate is ever paywalled out of the house's shared truth.
HOMI+ per-user subscription ($1.99/mo) for receipt scanning, unlimited history and export, budgets, and multiple houses.
A one-time move-out settlement report purchase, sold at the moment of highest willingness to pay.
Later, in-app settlement rails and moment-based partnerships around known lease-end and move-in dates.

---

## 9. Raw material for resume bullets

Facts you can quote directly, each verifiable in this repo.

- Designed and shipped a full-stack shared-expense platform solo across 7 two-to-three-day sprints, from empty repo to a live production deployment on Google Cloud Run and an iOS build on TestFlight.
- Built a financially-correct ledger in TypeScript with integer-cent arithmetic, property-based testing (fast-check) over four split modes, and database-enforced sum invariants, so splits provably reconcile to the total.
- Made every money mutation idempotent and transactional with stored idempotency keys plus a worker-driven retention prune, eliminating double-posting on client retries.
- Implemented immutable financial history: expense edits write revision snapshots and activity events rather than mutating rows, giving a full audit trail.
- Built recurring bill posting with hazard-first schedule math that fires exactly once per period in the house's own timezone.
- Delivered passwordless authentication (magic link plus email OTP) on web and React Native with Better Auth, routing the emailed link through a server interstitial and a deep link so the session is created in the app rather than the system browser.
- Designed a realtime layer over WebSockets with Redis pub/sub fan-out, deliberately limited to cache-invalidation hints so the server stays the single source of truth.
- Stood up production infrastructure on GCP: Cloud Run services, Cloud SQL Postgres, Cloud Scheduler, Artifact Registry, Secret Manager, and keyless GitHub Actions deploys via Workload Identity Federation.
- Built a CI/CD pipeline running typecheck, lint, unit and integration tests against ephemeral Postgres and Redis, a schema-versus-migration drift check, and a migration dry-run, with staging deploying from `main` and production from version tags behind a `/readyz` gate.
- Instituted an independent code review gate at every sprint close that caught production-grade defects each run, including a cross-user idempotency replay leak, a currency-mixing bug, a WebSocket upgrade-socket crash, and a shutdown deadlock.
- Ran the project with real agile artifacts: a pointed product backlog, sprint plans, a written Definition of Done, and retrospectives whose lessons changed the following sprint's practice.
- Made and documented explicit scope decisions, including deferring an entire release's worth of features to a hypothesis backlog until the money loop proves retention.
