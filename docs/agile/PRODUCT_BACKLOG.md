# HOMI v3 Product Backlog

Scope: R1, The Money Core (weeks 1-12, committed).
R2-R4 remain a hypothesis backlog per the spec (D4) and are intentionally not broken down here.

Story point scale: 1, 2, 3, 5, 8, 13 (Fibonacci).
Priority order within each epic is top to bottom.

## Epic E1: Infra skeleton

| ID | Story | Points | Status |
|---|---|---|---|
| HOMI-1 | As a developer, I have a monorepo with API, worker, db, and domain packages, local Docker env, lint, typecheck, and tests wired | 5 | Done (Sprint 1) |
| HOMI-4 | As a developer, CI runs typecheck, lint, unit tests, integration tests against ephemeral Postgres, migration dry-run, and build on every push | 5 | Done (Sprint 1) |
| HOMI-14 | As an operator, staging deploys to Cloud Run automatically from main; prod deploys from tagged releases | 8 | Backlog |
| HOMI-15 | As an operator, Sentry and OpenTelemetry are wired into API and worker with p95 and queue-lag dashboards | 5 | Backlog |

## Epic E2: Identity and houses

| ID | Story | Points | Status |
|---|---|---|---|
| HOMI-2 | As a user, I can sign in with Apple, Google, or an email magic link via Better Auth (no passwords) | 8 | Done (Sprint 2) |
| HOMI-3 | As a user, I can create a house with a timezone and currency, and I become its admin | 3 | Done (Sprint 1) |
| HOMI-8 | As an admin, I can create an invite link that a roommate can accept to join the house | 5 | Done (Sprint 2) |
| HOMI-9 | As a member, I can log expenses against a placeholder roommate who later claims their history atomically (H11) | 8 | Backlog |
| HOMI-10 | As a house, we can define rooms with weight basis points that sum to 10000, for room-weighted splits | 3 | Done (Sprint 2) |

## Epic E3: The Ledger

| ID | Story | Points | Status |
|---|---|---|---|
| HOMI-5 | As the system, split math is a pure, property-tested function: equal, exact, percent, and room-weighted modes, integer cents, deterministic remainder to the payer (H3) | 5 | Done (Sprint 1) |
| HOMI-6 | As a member, I can create an expense with any split mode; the write is idempotent (H1) and transactional, and splits always sum to the total | 8 | Done (Sprint 1) |
| HOMI-7 | As a member, I can see server-computed per-person balances from one balance function (invariant 3) | 5 | Done (Sprint 1) |
| HOMI-11 | As a member, I can record a settlement payment with a 72-hour dispute window | 5 | Done (Sprint 2) |
| HOMI-12 | As a member, I can edit an expense; the previous version is kept as a revision and the house is notified | 5 | Backlog |
| HOMI-13 | As a bill owner, recurring bills auto-post on their due date in the house timezone, exactly once per period (H4, H5) | 8 | Backlog |
| HOMI-16 | As a member, I see a unified cursor-paginated ledger of expenses and payments | 3 | Done (Sprint 3) |

## Epic E4: Engagement surfaces

| ID | Story | Points | Status |
|---|---|---|---|
| HOMI-17 | As a member, I get realtime feed updates over WebSocket, used only as cache-invalidation hints (H6) | 8 | Done (Sprint 3) |
| HOMI-18 | As a debtor, HOMI nudges me privately when a balance goes stale; creditors never have to ask (M3, M4) | 5 | Backlog |
| HOMI-19 | As a member, I receive a weekly digest of house balances and activity | 3 | Backlog |
| HOMI-20 | As a member, the HOME snapshot endpoint returns members, balances, action items, and feed head in one call | 5 | Done (Sprint 3) |

## Epic E5: Hardening and debt

| ID | Story | Points | Status |
|---|---|---|---|
| HOMI-21 | As a user, magic-link and notification emails are delivered via a transactional email provider | 3 | Backlog |
| HOMI-22 | As a developer, the legacy hand-rolled auth tables are dropped (contract phase of the HOMI-2 migration, H7) | 1 | Backlog |
| HOMI-23 | As a couple sharing a room, our room's weight splits across both occupants | 2 | Backlog |
| HOMI-24 | As an operator, auth and invite endpoints are rate limited (spec 5.5; magic-link send is an unauthenticated email loop) | 3 | Done (Sprint 3) |
| HOMI-25 | As the system, getBalances reads expenses and payments in one consistent snapshot instead of two statements | 2 | Done (Sprint 3) |
| HOMI-26 | As an operator, idempotency keys are pruned by a worker job after a retention window | 2 | Backlog (review M7) |
| HOMI-27 | As an operator, /healthz verifies DB connectivity so a wedged pool cannot report healthy | 1 | Done (Sprint 3) |

## Release gate (R1 to R2)

Median add-expense under 15 seconds.
Invited-roommate join rate above 60 percent.
Zero balance-math bug reports.
