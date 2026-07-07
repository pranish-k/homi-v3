# HOMI v3 - Full Product and System Architecture

**Version:** 3.0
**Purpose:** Complete specification for a full-fledged app that solves real-life roommate problems, built on a dedicated cloud SQL backend that can scale into a business.
**Status:** Working document (Pranish + Claude)
**Last Updated:** July 2026

---

## 1. Mission

Shared living fails not because people are bad, but because houses have no operating system.
Everything runs on memory, assumptions, and awkward conversations that nobody wants to start.
HOMI's job is to take the conversations roommates avoid and turn them into structure the app handles automatically.

The design test for every feature: **does this remove an awkward human conversation or prevent a fight before it starts?**
If a feature just digitizes a spreadsheet, it is not enough.

---

## 2. The Real Pain Map

This is the ground truth we build from.
Not "app features," but the actual fights, resentments, and failures of shared living, collected from how these conflicts play out in real life.

### 2.1 Money pains

| # | Real-life problem | What actually happens |
|---|---|---|
| M1 | Rent is split but rooms are unequal | The person in the small room quietly resents paying the same; nobody wants to renegotiate |
| M2 | Bills are in one person's name | That person fronts hundreds monthly, chases everyone, and eats the late fees when someone is slow |
| M3 | Small debts pile up and go stale | "$14 for pizza" is too small to chase and too annoying to forget; resentment compounds |
| M4 | Asking for money feels rude | The creditor stays silent for weeks, then explodes; the debtor honestly forgot |
| M5 | Shared groceries vs. personal groceries blur | One person buys household staples constantly and it is never evened out |
| M6 | The security deposit at move-out | Nobody remembers the original condition, one person caused the damage, everyone pays |
| M7 | Someone moves out mid-lease | Final settlement is chaos: utilities, deposit share, furniture they half-paid for |
| M8 | "I already paid you" disputes | No record of the Venmo from six weeks ago; both people are sure they are right |

### 2.2 Labor and cleanliness pains

| # | Real-life problem | What actually happens |
|---|---|---|
| L1 | Different definitions of "clean" | One person's "I'll do it later" is another's "disgusting"; both feel wronged |
| L2 | Chore effort is unequal even when counts are equal | Wiping the counter and deep-cleaning the bathroom both count as "one chore" |
| L3 | The same person always cracks first | The tidiest roommate does everything, becomes the house parent, and burns out |
| L4 | Nagging destroys relationships | Reminding someone about trash makes you the villain, so people stop asking and start seething |
| L5 | "It's done" vs. it is not really done | Task marked complete, dishes still crusty; no accountability without a confrontation |
| L6 | Nobody owns the invisible work | Buying toilet paper, taking out recycling, replacing sponges: unowned, so it falls to whoever cares most |

### 2.3 Supplies and shared stuff pains

| # | Real-life problem | What actually happens |
|---|---|---|
| S1 | Household staples run out with no warning | Toilet paper, dish soap, trash bags; everyone noticed, nobody bought |
| S2 | Food disappears from the fridge | Someone eats someone's leftovers; nobody confesses; passive-aggressive notes appear |
| S3 | Shared purchases have unclear ownership | Who keeps the couch, the TV, the air fryer when the lease ends? |
| S4 | One person funds the shared staples | See M5; the buyer never gets it back because logging $4 items is friction |

### 2.4 Communication and coexistence pains

| # | Real-life problem | What actually happens |
|---|---|---|
| C1 | The group chat buries everything important | "Landlord is coming Thursday" is 40 messages above the memes; someone misses it |
| C2 | "Nobody told me" | Rules and decisions exist verbally; memory diverges; every dispute becomes he-said-she-said |
| C3 | Guests and partners who basically move in | A fourth roommate using utilities and the shower, paying nothing; nobody dares say it |
| C4 | Noise and quiet hours | Different schedules (early classes vs. night shifts); asking for quiet feels like an attack |
| C5 | Expectations were never set | No move-in conversation about guests, cleaning, sharing, noise; every conflict is the first negotiation |
| C6 | Landlord and maintenance issues stall | Broken heater reported verbally to one roommate, who forgot; no trail, no follow-up |

### 2.5 Lifecycle pains

| # | Real-life problem | What actually happens |
|---|---|---|
| Y1 | Move-in chaos | Deposit paid unevenly, furniture bought ad hoc, utilities set up in random names, no baseline agreement |
| Y2 | Mid-lease drift | Agreements erode; new habits form; nobody renegotiates until someone snaps |
| Y3 | Move-out warfare | Deposit deductions, furniture buyouts, final utility bills, cleaning standards; friendships end here |
| Y4 | Finding and vetting the replacement roommate | Subletting or replacing someone mid-lease with zero structure |

**The pattern across all 24 pains:** each one is a missing system for either **memory** (who paid, who agreed, what condition it was in), **fairness** (effort, cost, and space measured honestly), or **voice** (a way to raise something without it becoming a confrontation).
HOMI is those three systems, in one app.

---

## 3. The Solution: Five Pillars

Every pillar maps to specific pains above.
Together they cover the full lifecycle of a shared home: move in, live together, move out.

### Pillar 1: The Ledger (money) - solves M1-M8

The financial single source of truth for the house.

- **Expenses in under 10 seconds** with equal, exact, percentage, or **room-weighted** splits.
  Room weighting (M1): set once at move-in ("Master with bathroom: 40%, mid room: 32%, small room: 28%"), applied automatically to rent and optionally utilities.
  The app also offers a neutral suggested split from room attributes (size, private bath, window, closet), so the negotiation is with a calculator, not with each other.
- **Bill ownership tracking** (M2): each recurring bill has an owner ("Internet is in Sarah's name"); the app auto-posts the split on the due date and nudges the others *before* the owner has to.
  Optionally rotate bill ownership yearly so the credit exposure is shared.
- **Automatic debt hygiene** (M3, M4): balances roll up per person, and HOMI does the asking.
  Weekly digest plus a polite nudge to debtors when a balance goes stale.
  The creditor never has to send the awkward text; that is the emotional core of the product.
- **Staples auto-fairness** (M5, S4): purchases tagged "household staple" feed a running staples balance shown monthly ("Sarah has covered $38 of staples this cycle; you've covered $6"), with a one-tap even-up.
- **Settlement with proof** (M8): pay via Venmo/Zelle/Cash App deep link, record in one tap, permanent timestamped history.
  Payments are single-sided with a 72-hour dispute window, so nothing stalls waiting for confirmation.
- **Deposit and move-out ledger** (M6, M7, Y3): deposit contributions recorded at move-in; condition photos attached to a move-in checklist; at move-out, HOMI generates the final settlement (deposit shares, last bills, staples true-up, furniture buyouts) as one clean exportable report.

### Pillar 2: Fair Chores (labor) - solves L1-L6

Not a to-do list; a fairness engine.

- **Effort-weighted chores** (L2): every chore has a point weight (bathroom deep clean: 5, taking out trash: 1); defaults provided, house-adjustable.
  Fairness is measured in points per person per period, not task counts.
- **Fairness data, private-first** (L3): points contributed per person per cycle are tracked from day one, but surfaced privately: each member sees their own stats, and the data drives HOMI's automatic nudges to whoever is behind.
  A house-visible fairness gauge is deliberately NOT the default: quantified score-keeping between roommates can weaponize the data and make fights worse.
  A house can opt in to a shared view; we test whether that helps or harms before making it standard.
- **Rotations that survive reality** (L4): round-robin rotation advanced server-side; missed turns roll forward and the fairness meter records the miss, so skipping does not silently push work onto the next person.
- **The app is the nagger** (L4): reminders come from HOMI on schedule (before due, at due, 24h overdue), always to the owner only, never blasting the house.
  Roommates never have to remind each other; that single design choice removes the villain role from the house.
- **House standards, written once** (L1, L5): each chore can carry a short definition of done ("Dishes = washed, dried, put away, sink wiped"), set in the house norms (Pillar 4).
  Disputes about "done" are settled by the written standard, not by whoever argues harder.
  Optional photo-on-completion per chore for houses that want it (off by default).
- **Invisible work made visible** (L6): recurring micro-chores (buy TP, replace sponge, take out recycling) exist as real weighted chores in the rotation, so the caring-most person stops absorbing them.

### Pillar 3: Supplies and Shared Stuff - solves S1-S4

- **The staples list** (S1): a shared list of household consumables with one-tap "we're low" from anyone (also available from a home-screen widget).
  Whoever shops taps items bought, and the expense posts to the ledger automatically with the staples tag; restocking becomes a 5-second act instead of a favor nobody repays.
- **Fridge and food norms** (S2): the house norms include a food-sharing policy (everything shared / labeled is private / all private).
  Not a surveillance feature; a norms feature.
  The passive-aggressive note is replaced by an agreed rule that existed before the leftovers did.
- **The shared asset registry** (S3, Y3): shared purchases above a threshold (couch, TV) get an owner split recorded at purchase time from the ledger entry.
  At move-out, the house agrees on a buyout price per item (humans set the number; an automatic depreciation formula would just create a new thing to argue about), and HOMI records who keeps it and splits the payout by the recorded ownership shares.

### Pillar 4: House Norms and the Board - solves C1, C2, C5, C6, Y2

- **House Norms** (C2, C5): a lightweight, pre-filled norms sheet (quiet hours, guest policy, cleaning standards, food sharing, smoking, subletting) that exists from day one with sensible defaults and takes 2 minutes to adjust, not a 10-minute ceremony.
  Anyone can edit; every change is tracked (who, when, what) and announced to the house.
  We deliberately dropped the formal all-members-consent flow from the original design: guided agreement ceremonies with signatures are exactly the awkward formalization roommates avoid, and adoption would be near zero.
  The norms sheet earns its keep passively: it is referenced automatically when a dispute thread opens, so "nobody told me" dies without anyone having to hold a meeting.
- **The Board** (C1, C6): one pinned surface per house for reference info (WiFi, lease dates, landlord contact, trash day) and important notices ("Landlord inspection Thursday 2pm") with read receipts.
  Not a chat; the group chat keeps the memes, HOMI keeps the record.
- **Maintenance log** (C6): report an issue with photos, assign a reporter-to-landlord owner, track status (reported / landlord notified / scheduled / fixed), full trail with dates for lease disputes.
- **Deferred: guest calendar and quiet-hours schedules** (C3, C4).
  Both depend on roommates manually logging social plans, which is the same failure mode as v2's manual home/away toggle: the data never gets entered, so the feature never fires.
  The guest and noise pains are real, but they stay on the hypothesis backlog until we find a zero-entry design; the guest *policy* still lives in House Norms so the expectation at least exists in writing.

### Pillar 5: Lifecycle Flows - solves Y1-Y4

- **Move-in flow** (Y1): guided checklist that seeds the whole system in one session: deposit contributions -> room-weight rent split -> bill ownership -> condition photos -> house norms -> staples list.
  A house that completes move-in flow is fully configured for everything above.
- **Renegotiation prompts** (Y2): at lease milestones (6 months, renewal), HOMI suggests a 5-minute house check-in: review contribution stats, the staples balance, and the norms sheet.
  Drift gets corrected on a schedule instead of at a breaking point.
- **Move-out flow** (Y3, M6, M7): triggered per member or whole house: final bill proration, deposit reconciliation against condition photos, asset registry buyouts, staples true-up, and a final settlement report everyone signs off on in-app.
  This is HOMI's signature moment: the move-out that ends friendships today becomes a 15-minute checklist.
- **Roommate transition** (Y4): departing member's ledger is frozen and settled; a replacement joins via invite link, inherits the room weight and house norms, and reviews the standards before day one.

---

## 4. App Structure

### 4.1 Navigation

```
Tabs:  HOME        MONEY       [+]        CHORES      HOUSE
       Pulse       Ledger      Create     My chores,  Norms, Board,
       feed,       balances,   expense/   rotations,  staples, assets,
       action      settle,     chore/     my stats    maintenance,
       bar         history     note/                  members, flows
                               supply
```

- **HOME:** the answer to "what needs my attention?": action chips (pay, dispute window, chore due, norms change to review), then the house activity feed (realtime).
- **MONEY:** net position, per-person balances with show-the-math drilldowns, settle flow, recurring bills, history.
- **[+] Create:** expense, chore, board note, supply-run. Two-tap access to the two most common (expense, mark supply low).
- **CHORES:** my chores today, house rotations with face chain, my contribution stats, standards.
- **HOUSE:** House Norms, Board, staples list, asset registry, maintenance log, members, move-in/move-out flows, settings.

### 4.2 Key experience principles (carried from v2, still right)

- One-thumb layout; every core action reachable from the tab bar.
- Direct, non-judgmental copy ("You owe Sarah $25", never passive-aggressive).
- Context over chat: discussion threads attach to the thing (expense, chore, maintenance issue), not a general chat.
- The app takes the villain role: all nagging, all sensitive surfacing (stale debts, fairness gaps) comes from HOMI, privately, to the relevant person first.
- v2 design system carries over (colors, spacing, type, Ionicons) with dark mode and Dynamic Type from day one.

### 4.3 Zero-friction entry points

- **Invite links**, not codes: `homi.app/j/<token>`, single tap, deferred deep link through the app store.
- **Placeholder roommates:** log expenses against "Sam" before Sam joins.
  Framing matters here: Sam's invite says "review and approve your share", never "you owe $214", and every inherited line item has a one-tap dispute.
  A new member's first experience must be reviewing a transparent breakdown, not receiving a bill compiled behind their back; done wrong, this mechanic converts worse than a plain invite.

---

## 5. System Architecture

### 5.1 Overview

Owned backend, dedicated cloud SQL, no BaaS coupling.

```
┌─────────────────────────────────────────────────────────────┐
│  Clients                                                     │
│  iOS / Android (Expo React Native, TypeScript)               │
│  Web app later (same API)                                    │
└──────────────┬───────────────────────────┬──────────────────┘
               │ HTTPS (REST + JSON)       │ WebSocket (realtime)
┌──────────────▼───────────────────────────▼──────────────────┐
│  Edge: Load balancer + WAF + rate limiting                   │
└──────────────┬───────────────────────────┬──────────────────┘
┌──────────────▼──────────────┐ ┌──────────▼──────────────────┐
│  API service (stateless,     │ │  Realtime gateway            │
│  Node.js + TypeScript,       │ │  (WebSocket, house channels, │
│  NestJS, modular monolith)   │ │  fed by Redis pub/sub)       │
└───────┬──────────┬───────────┘ └──────────▲──────────────────┘
        │          │                        │
        │          └──────► Redis ──────────┘
        │                  (cache, pub/sub, rate limits,
        │                   BullMQ job queues)
        │                        │
        │                 ┌──────▼───────────────────────┐
        │                 │  Worker service (BullMQ):     │
        │                 │  recurring bills, rotations,  │
        │                 │  reminders, digests, nudges,  │
        │                 │  push fan-out, exports        │
        │                 └──────┬───────────────────────┘
┌───────▼──────────────────────▼───────────────────────────────┐
│  PostgreSQL (dedicated managed cloud SQL:                     │
│  AWS RDS / GCP Cloud SQL, Multi-AZ, PITR backups,             │
│  read replica when needed)                                    │
└───────────────────────────────────────────────────────────────┘
   Side services: S3-compatible object storage + CDN (receipts,
   condition photos, avatars, signed URLs only) · APNs + FCM push
   · Sentry (errors) · OpenTelemetry -> Grafana (metrics/traces)
   · PostHog (product analytics)
```

### 5.2 Component decisions and rationale

**PostgreSQL on managed cloud SQL (decided: GCP Cloud SQL, see D1).**
Your call, and the right one: a ledger, an agreement history, and a fairness engine are relational to the bone.
Managed flavor gives Multi-AZ failover, point-in-time recovery, and automated backups without hiring for DBA work.
Start on a modest instance (e.g., 2 vCPU / 8GB, gp3); this comfortably serves tens of thousands of households, and the scaling path (Section 8) is boring and well-trodden.

**Node.js + TypeScript + NestJS, as a modular monolith.**
One language across client and server means shared DTO types end to end (a money app cannot afford client/server type drift).
NestJS gives module boundaries (ledger, chores, house, notifications, identity) that keep the monolith honest and make later extraction possible, without paying microservice tax on day one.
Prisma or Drizzle as the ORM with raw SQL escape hatches for ledger math; every schema change is a checked-in, reviewed migration.

**Redis.**
Four jobs: hot cache (balances, house snapshots), pub/sub backing the realtime gateway, rate limiting (auth, invites, nudges), and BullMQ queues.
One managed Redis (ElastiCache / Memorystore) covers all four at this scale.

**Realtime gateway.**
WebSocket service, one channel per household, JWT-authenticated at connect.
API and workers publish domain events to Redis pub/sub; the gateway fans out to connected house members; clients invalidate their local cache (TanStack Query) on event receipt.
Roommate adds an expense, it is on your screen in under a second.
Fallback to polling only when the socket is down.

**Workers (same codebase, separate process).**
Everything time-based is server-side, never client-side: recurring bill posting, rotation advancement and overdue marking, reminder scheduling, stale-debt nudges, weekly digests, guest-threshold checks, renegotiation prompts, report generation.
BullMQ with idempotent, retry-safe jobs; a missed cron tick can never double-post rent.

**Auth (adopted, not hand-rolled).**
Sign in with Apple, Google OAuth, and email magic links; no passwords.
Decision: we do NOT hand-roll token rotation, revocation, and OAuth flows; that is a classic underestimated pit with security downside and zero product differentiation.
We use Better Auth (a TypeScript auth library that runs inside our NestJS service and stores sessions/identities in our own Postgres), so we keep full data ownership without owning the crypto details.
Fallback if it fights us: Clerk (hosted, excellent Expo support), accepting the vendor dependency.
Sessions per device; push tokens bound to sessions; owning login is not strategic, owning the ledger is.

**Storage.**
S3-compatible bucket, private, CDN in front, short-lived signed URLs only.
Content: receipts, move-in condition photos, chore-completion photos, avatars, exported reports.

**Push.**
APNs + FCM directly (not Expo's push relay, since we own the backend), abstracted behind one notification service with per-user, per-type preferences and delivery tracking.

### 5.3 API design

REST, versioned (`/v1`), JSON, cursor pagination, idempotency keys on all money mutations.
Representative surface:

```
POST   /v1/auth/{apple|google|magic-link}     Sessions + refresh rotation
GET    /v1/me                                  Profile, houses, preferences

POST   /v1/houses                              Create (triggers move-in flow)
POST   /v1/houses/:id/invites                  Create invite link
POST   /v1/invites/:token/accept               Join + claim placeholder
GET    /v1/houses/:id/snapshot                 One call: members, balances,
                                               action items, feed head
                                               (the HOME tab in one request)

POST   /v1/houses/:id/expenses                 Idempotency-Key required
PATCH  /v1/expenses/:id                        Creates revision, notifies house
GET    /v1/houses/:id/balances                 Server-computed, the only source
POST   /v1/houses/:id/payments                 Record settlement
POST   /v1/payments/:id/dispute                72h window, opens thread
GET    /v1/houses/:id/ledger?cursor=           Unified expenses + payments

POST   /v1/houses/:id/chores                   With weight, schedule, rotation
POST   /v1/chore-occurrences/:id/complete      Atomic: close + advance rotation
GET    /v1/houses/:id/fairness?period=         Points per member, misses

GET    /v1/houses/:id/norms                    Norms sheet + change history
PUT    /v1/houses/:id/norms                    Edit (tracked, announced)

POST   /v1/houses/:id/supplies/:id/flag        "We're low" (also via QR)
POST   /v1/houses/:id/board/posts              Notice with read receipts
POST   /v1/houses/:id/maintenance              Issue + photos + status trail
POST   /v1/houses/:id/moveout                  Starts settlement flow
GET    /v1/moveouts/:id/report                 Final settlement document
```

Rules baked into the API layer:

- All invariants enforced in transactions server-side (split sums equal totals, rotation advances exactly once, consent requires all active members).
- Clients render state and request changes; they never compute state.
- Money returned as integer cents with currency; formatting is a client concern.

### 5.4 Database schema (core)

```sql
-- Identity and membership
users              (id, email, name, avatar_path, created_at, deleted_at)
auth_identities    (id, user_id, provider, provider_uid)
sessions           (id, user_id, refresh_hash, device, expires_at, revoked_at)
push_tokens        (user_id, session_id, platform, token, updated_at)

houses             (id, name, timezone, currency, created_by, created_at)
house_members      (house_id, user_id, role,            -- admin | member
                    display_name, is_placeholder bool, claimed_by,
                    room_id, joined_at, left_at,
                    PRIMARY KEY (house_id, user_id))
rooms              (id, house_id, name, weight_bp int)   -- basis points, sums to 10000
invites            (id, house_id, token_hash, created_by, expires_at,
                    max_uses, uses, revoked_at)

-- Ledger (immutable, append-only for money truth)
expenses           (id, house_id, description, amount_cents bigint,
                    currency char(3), paid_by, category,
                    is_staple bool, receipt_path, template_id,
                    created_by, created_at, deleted_at)   -- soft delete only
expense_splits     (expense_id, user_id, amount_cents,
                    PRIMARY KEY (expense_id, user_id))
expense_revisions  (id, expense_id, changed_by, changed_at, previous jsonb)
bill_templates     (id, house_id, description, amount_cents, owner_id,
                    split_mode,        -- equal | exact | percent | room_weighted
                    split_config jsonb, cadence, cadence_day,
                    next_run date, active bool)
payments           (id, house_id, from_user, to_user, amount_cents, currency,
                    method, status,    -- recorded | disputed | resolved
                    created_at, disputed_at, resolved_at)
deposits           (id, house_id, user_id, amount_cents, paid_at, note)

-- Chores and fairness
chores             (id, house_id, name, definition_of_done text,
                    weight int, schedule jsonb, requires_photo bool,
                    created_by, archived_at)
chore_rotation     (chore_id, position, user_id)
chore_occurrences  (id, chore_id, due_at, assigned_to,
                    status,            -- open | done | missed
                    completed_by, completed_at, photo_path)
-- Fairness meter = SQL over occurrences (points done, points missed)
-- per member per period; computed server-side, one function, every surface.

-- House Norms (lightweight, edit-tracked; no consent machinery)
house_norms        (house_id PRIMARY KEY, content jsonb, updated_by, updated_at)
house_norm_history (id, house_id, previous jsonb, changed_by, changed_at)

-- Supplies, assets, board, maintenance
supplies           (id, house_id, name, status,    -- ok | low | out
                    flagged_by, flagged_at, last_bought_expense_id)
assets             (id, house_id, name, purchase_expense_id,
                    ownership jsonb,               -- {user_id: share_bp}
                    buyout_status, resolved_at)
board_posts        (id, house_id, author_id, kind,  -- info | notice
                    title, body, pinned, created_at, expires_at)
board_reads        (post_id, user_id, read_at, PRIMARY KEY (post_id, user_id))
maintenance_issues (id, house_id, title, description, reported_by,
                    owner_id, status, created_at)
maintenance_events (id, issue_id, actor_id, status_from, status_to,
                    note, photo_path, created_at)

-- Lifecycle
moveouts           (id, house_id, user_id,          -- null = whole house
                    initiated_at, effective_date, status,
                    settlement jsonb, report_path, completed_at)

-- Notifications and audit
notifications      (id, user_id, house_id, type, title, body,
                    entity_type, entity_id, read_at, created_at)
notification_prefs (user_id, type, push bool, digest bool)
activity_events    (id, house_id, actor_id, type, entity_type, entity_id,
                    payload jsonb, created_at)
  -- single append-only feed table; drives HOME feed, realtime fan-out,
  -- and the audit trail; partitioned by month at scale
```

Non-negotiable money invariants:

1. Money rows are never hard-deleted or silently edited; every change writes a revision and a feed event.
2. `SUM(expense_splits.amount_cents) = expenses.amount_cents`, enforced in the transaction.
3. One balance function; every surface (header, drilldown, nudge, digest, move-out report) reads it.
4. Idempotency keys on expense/payment creation; mobile retries can never double-post.
5. Members are deactivated (`left_at`), never deleted, so historical ledger lines always resolve to a name.

### 5.5 Infrastructure and operations

- **Runtime:** containers (Docker) on ECS Fargate or Cloud Run: `api`, `realtime`, `worker`.
  Stateless, horizontally scalable, no servers to patch.
- **Environments:** `dev` (local Docker Compose: Postgres + Redis + MinIO), `staging`, `prod`; identical via Terraform.
- **CI/CD:** GitHub Actions: typecheck, lint, unit + integration tests (against ephemeral Postgres), migration dry-run, then build/deploy to staging on main and prod on tagged release.
  EAS for mobile builds; OTA updates for JS-level fixes; feature flags (config table) for cohort rollouts.
- **Backups/DR:** automated daily snapshots + PITR on Postgres; quarterly restore drill; S3 versioning on the bucket.
- **Observability:** Sentry on client and server; OpenTelemetry traces API -> DB; dashboards and alerts on p95 latency, job-queue lag, socket connection counts, and push delivery rates.
- **Security:** TLS everywhere, VPC-private DB and Redis, secrets in the cloud secret manager, invite tokens hashed at rest, signed URLs for all media, per-house authorization checks in a single guard layer (every query scoped by verified house membership), rate limits on auth/invite/nudge endpoints, account deletion flow (store requirement) that anonymizes the user while preserving house ledger integrity.

### 5.6 Testing standards

- Money and fairness math: unit-tested, including property-based tests (random splits always sum; rotation always advances exactly once under concurrent completion).
- API integration tests run against real Postgres in CI, including authorization tests asserting cross-house access fails.
- Ledger code does not merge without tests; this is a hiring-bar-level rule, not a goal.

### 5.7 Engineering hazards and required mitigations

The failure modes that actually kill apps like this, and the mitigations that are non-negotiable in code review.
The governing rule: **every money-touching operation must be safe to retry and impossible to partially complete.**

**H1. The ambiguous write (the worst one).**
A phone sends "create expense," the server commits, and the response is lost on cellular; the user retries and rent posts twice.
Or the app shows success optimistically and the server never received it.
Required, all three:
(a) the client generates an idempotency key (UUID) per user action, reused across retries; the server stores key -> result and replays the stored response instead of re-executing;
(b) every multi-row write (expense + splits + activity event + notifications) is one DB transaction, never sequential calls;
(c) the client keeps a local outbox: the pending action is persisted to disk before sending and cleared only on confirmed response, so an app killed mid-request retries on next launch with the same key.

**H2. Concurrent writes racing.**
Two roommates complete the same chore occurrence at once; rotation advances twice.
Two people settle the same debt simultaneously.
Mitigations: state-transition guards in SQL (`UPDATE ... WHERE status = 'open'`, check rows affected), `SELECT ... FOR UPDATE` for read-then-write, and unique constraints as the last line of defense (one open occurrence per chore per due date; one materialized bill per template per period).

**H3. Split rounding.**
$100 / 3 = 3333 + 3333 + 3333 = 9999 cents.
A deterministic remainder rule (extra cents to the payer), computed server-side only; if the client previews a different number than the server commits, user trust dies.
Integer cents everywhere; `SUM(splits) = total` enforced in the transaction.

**H4. Scheduled jobs double-firing or silently not firing.**
A worker crash-restart or two worker instances must never double-post rent: materialization is keyed on `(template_id, period)` with a unique constraint so re-runs are no-ops.
The quiet failure is worse: cron silently stops and rent just does not post; we alert on "expected job did not run," not only on errors.

**H5. Timezones.**
"Rent on the 1st" is computed in the house's stored timezone, server-side, never in client-local time.
Handle Jan 31 + 1 month, and DST days where an hour does not exist.

**H6. Stale clients and realtime drift.**
WebSocket events delivered while a phone was offline are gone forever.
Realtime is therefore only an invalidation hint, never the data itself: on reconnect/foreground, the client refetches snapshots.
Offline stance (decided): read-only offline via cache (TanStack Query stale-while-revalidate) plus the H1 outbox for queued writes; full offline sync with conflict resolution is explicitly out of scope for v3.

**H7. Old app versions live for months.**
Mobile users do not update; a v1.2 client hits the API long after v1.4 ships.
Every API change is backward-compatible or versioned; every migration follows expand-migrate-contract so old-shaped requests keep working mid-deploy.

**H8. Push is best-effort.**
APNs/FCM drop, throttle, and expire tokens; tokens die on reinstall.
Handle token refresh, track delivery where possible, and keep the in-app notification center as the durable record so nothing important exists only as a push.

**H9. Auth and membership edge cases.**
Account deletion (App Store mandated) while owing money: anonymize the user, never orphan ledger lines.
Removal from a house while holding a valid JWT and open socket: authorization is checked per-request against current membership, never baked into the token.
Two devices racing refresh-token rotation.

**H10. Optimistic UI that lies.**
A silently vanishing expense is worse than a spinner.
Optimistic rendering only for actions that essentially cannot fail server-side; anything with real validation waits, and every rollback is visible and explained.

**H11. Placeholder claiming races.**
Two people claiming the same placeholder, one person joining via two links, a placeholder edited into expenses mid-claim: claiming is one atomic, guarded operation.

**H12. The boring killers.**
Connection pool exhaustion (pgBouncer earlier than feels necessary); unbounded list queries (cursor pagination from day one, retrofitting it onto shipped clients is miserable); photo uploads proxied through the API (never; presigned direct-to-S3, then confirm to the API).

---

## 6. Scaling Path

Written down now so growth is a checklist, not a crisis.

| Stage | Households | What changes |
|---|---|---|
| 1 | 0 - 10k | Single API instance x2 (for deploys), one Postgres, one Redis. Nothing clever. |
| 2 | 10k - 100k | Horizontal API/worker autoscaling; Postgres read replica for feeds/history/reports; balance cache in Redis with event-driven invalidation; partition `activity_events` monthly. |
| 3 | 100k - 1M | Realtime gateway scaled with Redis-backed presence; pgBouncer connection pooling; move exports/reports fully async; consider extracting the notification service. |
| 4 | 1M+ | Shard-by-house is natural (a house is a perfect isolation unit, no cross-house queries exist); evaluate Citus or app-level sharding. Not a today problem, but the schema never blocks it: every table carries `house_id`. |

The key property: **the household is the atomic unit.**
No feature ever queries across houses, which makes every scaling move above mechanical.

---

## 7. Delivery Plan

R1 is a commitment; R2-R4 are a **hypothesis backlog**, sequenced but not promised.
This distinction is the guardrail against v2's failure mode (building breadth before any loop retains).
If R1 retention is weak, the answer is fixing R1, not hoping the next pillar fixes it; we must be genuinely willing to spend six months on money alone if that is what the numbers say.
Each release that does ship is complete and polished, not a stub.

**R1 - The Money Core (weeks 1-12, committed).**
Auth (Better Auth, not hand-rolled; see 5.2), houses, invites + placeholders, rooms + weighted splits, expenses (all split modes), bill templates + server-side recurring, balances, settle + dispute, push + digests + stale-debt nudges, realtime feed, HOME action bar.
Infra: the Section 5 skeleton (API, worker, realtime, CI/CD, observability), because retrofitting infrastructure is costlier than building on it.
Twelve weeks, not eight: the infra skeleton is realistically 3-4 weeks before the first product screen, and an honest plan beats an optimistic one.

**R2 - Fair Chores (est. 6 weeks, hypothesis).**
Weighted chores, rotations, occurrences, private-first contribution stats feeding nudges, definitions of done, app-as-nagger reminders, optional per-chore photo completion (off by default).

**R3 - The House Layer (est. 5 weeks, hypothesis).**
House Norms (lightweight sheet, edit-tracked), Board with read receipts, staples list + widget, maintenance log.

**R4 - Lifecycle (est. 6 weeks, hypothesis).**
Move-in flow (ties everything together), asset registry (human-priced buyouts), deposit tracking, renegotiation prompts, move-out flow + settlement report, roommate transition.

**Beta throughout:** 5-10 real households (including your own) live on R1 from week 12; their friction reports reorder the backlog.

Gates between releases (measured, not vibes):

- R1 -> R2: median add-expense under 15s; invited-roommate join rate above 60%; zero balance-math bug reports.
- R2 -> R3: chores adopted by 25%+ of active houses within 2 weeks.
- Always-on funnel: signup -> house -> first expense -> invite sent -> second member -> first settlement; the weakest step is the current top priority.

---

## 8. Business Model

- **Free:** the full core loop for every pillar; the network effect depends on whole houses joining, and one paywalled roommate breaks the house.
- **HOMI+ (per user, $1.99/mo or $14.99/yr, with a discounted whole-house unlock):** receipt scanning with item-level assignment, unlimited history + CSV/PDF export, budgets per category, multiple houses.
  Per-user, not per-household: a single household subscription has an unsolved who-pays problem (one roommate paying for everyone recreates the freeloader dynamic the app exists to solve, and split-billing a subscription is comedy).
- **Move-out settlement report (one-time purchase per house, ~$14.99):** the signed, exportable final settlement document, sold at the single moment of highest willingness to pay; the cost splits through the ledger itself like any other shared expense.
- **Transactional (later, the real business):** in-app settlement rails (instant-transfer fees, standard free), and moment-based partnerships: HOMI knows lease-end and move-in dates, which makes renters insurance, movers, utility setup, and furniture referrals high-intent rather than spam.
- **Never:** selling data, ads in the feed, paywalling anything that locks a roommate out of the house's shared truth.

---

## 9. Decisions Log

Settled July 2026 after auditing this spec against its own failure modes.

| # | Decision | Call | Why |
|---|---|---|---|
| D1 | Cloud provider | **GCP** (Cloud SQL + Cloud Run + Memorystore + GCS) | Simplest ops for a small team; Cloud Run scale-to-zero keeps early costs near nothing; everything here has a 1:1 AWS equivalent if we ever migrate |
| D2 | ORM | **Drizzle** | The ledger and fairness queries are SQL-heavy; Drizzle stays close to SQL instead of fighting it |
| D3 | Auth | **Adopt Better Auth** (library in our NestJS service, data in our Postgres); fallback Clerk | Hand-rolled token rotation/OAuth is an underestimated security pit with zero differentiation; owning the ledger is strategic, owning login is not |
| D4 | Delivery framing | **R1 committed (12 weeks, not 8); R2-R4 are a hypothesis backlog** | Guardrail against v2's breadth-before-retention failure; if money does not retain, we fix money |
| D5 | House Agreement | **Simplified to House Norms**: pre-filled sheet, anyone edits, changes tracked and announced; no consent ceremony | Guided all-members-sign flows are the awkward formalization roommates avoid; adoption would be near zero |
| D6 | Fairness visibility | **Private-first**: own stats + HOMI's nudges; house-visible gauge is opt-in and treated as an experiment | Public score-keeping between roommates can weaponize the data and escalate conflict |
| D7 | Guest calendar, quiet-hours schedules, guest thresholds | **Cut from committed scope** (hypothesis backlog) | Depend on manual logging of social plans, the same failure mode as v2's home/away toggle; guest policy still exists in House Norms |
| D8 | Chore photo-proof | **Off by default**, per-chore opt-in | Trust-first; surveillance defaults poison the tone |
| D9 | Fridge QR code | **Cut** | Renters do not own printers; widget covers the job |
| D10 | Asset buyouts | **Humans set the price; HOMI records shares and splits the payout** | An automatic depreciation formula just creates a new thing to argue about |
| D11 | Placeholder-debt invites | Keep, reframed as **"review and approve your share"** with per-line one-tap dispute | "You owe $214" as a first impression is adversarial and would convert worse than a plain invite |
| D12 | Premium structure | **Per-user HOMI+ plus a one-time move-out report purchase**; never per-household subscription | Household billing has an unsolved who-pays problem |
| D13 | Offline | **Read-only offline (cache) + outbox for queued writes; no full offline sync in v3** | Conflict resolution against a server-owned ledger is a project of its own; see H1/H6 |
| D14 | v2 code | **Salvage UI components and design tokens only**; backend and data layer start fresh | v2 is a prototype; its architecture is the thing being replaced |

Risks we accept knowingly: chore features may still underperform (chore-app retention is historically poor; that is why they are R2, not R1), and the placeholder-invite mechanic needs live-beta validation of its framing before we lean on it for growth.

---

## 10. Summary

Twenty-four real pains, three missing systems (memory, fairness, voice), five pillars that install those systems across the full life of a shared home.
Underneath: an owned, boring-on-purpose architecture: NestJS modular monolith, dedicated managed Postgres, Redis, workers, WebSockets, on containers with real CI, tests, and observability from day one.
The household is the atomic unit of both the product and the database, which is what makes this scale mechanically instead of painfully.

HOMI v2 described an app.
This is the operating system for shared living, specified end to end, with the awkward conversations designed out of the house and into the software.