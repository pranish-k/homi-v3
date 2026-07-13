# HOMI v3 Progress

**Last updated:** 2026-07-13 (HOMI-28 shipped; demo detour findings backlogged)

## Demo detour (2026-07-11)

Branch `demo/web` (on GitHub) carries a throwaway browser demo: a Vite + React SPA against the real local API, with three hardcoded test users signed in through a dev-only endpoint that replays the logged magic link.
It exists to click through the R1 surface on a laptop before Sprint 4; it never merges, and R1 work continues on `main` as if nothing happened.
Switching:

```bash
git checkout demo/web && npm ci   # work on the demo (see DEMO.md there)
git checkout main && npm ci       # back to the real project
git branch --show-current         # see where you are
```

Clicking through the demo (2026-07-13) surfaced two product gaps, now backlogged: HOMI-28 (magic-link signup leaves user.name empty and nothing writes display_name, so every surface can show nameless members) and HOMI-29 (a disputed payment dead-ends; the `resolved` status exists in schema and computeBalances but has no endpoint or product flow).
The API itself checked out: balances, pairwise netting, dispute guards, and idempotency all behaved correctly.


**Phase:** R1 Money Core (weeks 1-12, committed scope)
**Repo:** https://github.com/pranish-k/homi-v3 · tag `v0.3.0-sprint3` + review fixes (`312f7ad`) · CI: green (main and tag runs)

## Done (Code review + hardening, 2026-07-09)

- Multi-agent code review of the Sprint 3 diff (5 finder angles); findings fixed same day (commit `312f7ad`)
- CRITICAL: an unhandled 'error' event on the raw upgrade socket during the async WS handshake could kill the whole API process; a client resetting the TCP connection mid-auth was a remotely triggerable crash
- CRITICAL: Nest closes the HTTP server before onApplicationShutdown runs, so one connected phone made httpServer.close() wait forever and turned every deploy into a SIGKILL; socket teardown moved to beforeApplicationShutdown
- HIGH: the per-IP magic-link budget keyed on the FIRST x-forwarded-for entry, which is client-controlled; a spoofed header minted a fresh budget per request (and could poison a victim's); now keyed on the LAST entry, the one the load balancer appends
- HIGH: after a Redis close the message handler was never rewired onto a fresh subscriber connection (stale boolean), silently dropping every hint; wiring is now tracked per client
- HIGH: the WS subscription is awaited before the 101 handshake completes, so a hint published right after 'open' cannot race past the SUBSCRIBE ack (was a CI-only flake risk)
- MEDIUM: a Redis rate-limit counter that lost its TTL locked its subject out permanently (retry-after 1s forever); the Lua script now repairs missing expiries
- MEDIUM: /healthz probed the DB, so a transient DB blip would have had an orchestrator restart every healthy instance; /healthz is pure liveness again and the DB probe moved to /readyz
- MEDIUM: getLedger read expenses and payments in two auto-commit statements (the torn-read pattern HOMI-25 fixed in getBalances); now one repeatable-read snapshot
- Cleanups: house.created now publishes like every other event; publish ids derive from transaction results; lastMagicLink bounded; rate-limit tests reset warm Redis budgets
- Accepted for later: getBalances folds full history per call (Redis hot cache is the spec plan); publish-per-method refactor to derive hints from activity_events (queued Sprint 4); WS membership recheck (no member-removal endpoint exists yet)

## Done (HOMI-28 member names, 2026-07-13)

- Magic-link sign-up accepts an optional name applied on first registration only; the contract is pinned by integration tests (a later sign-in with a different name cannot rename the account) [HOMI-28]
- PATCH /v1/houses/:houseId/members/me sets or clears the per-house display_name: HouseMemberGuard, transactional with a row lock, emits member.renamed + realtime hint only when the value actually changes
- 6 new integration tests (32 total): sign-up capture, name immutability, set/clear via snapshot, feed-event dedup, validation bounds, cross-house 403
- HOMI-29 (dispute resolution) decided but not built: recipient-only resolves (confirm -> resolved counts again, or stand firm and the payer re-records); see backlog

## Done (Sprint 3, 2026-07-08)

- HOME snapshot endpoint: members, balances, per-caller action items, 20-event feed head in one repeatable-read transaction [HOMI-20]
- Realtime WebSocket gateway: one channel per house, session + membership checked at connect via the same MembershipService as HTTP, hints only (ids and types, never data, H6), published only after commit and never on idempotent replays; Redis pub/sub when configured, in-process fallback for single-node dev (prod refuses the fallback) [HOMI-17]
- Unified ledger: expenses + payments newest-first behind an opaque keyset cursor on (created_at, id); paginated created_at columns narrowed to timestamptz(3) so ms-precision JS cursors cannot skip µs rows (migration `0003_ledger_pagination`) [HOMI-16]
- Rate limiting: magic-link sends 3/email and 30/IP per 15 min (Better Auth before-hook), invite create/accept 20/user/hour (Nest guard), 429 + Retry-After, Redis-backed when configured [HOMI-24]
- Drive-bys: getBalances reads one repeatable-read snapshot [HOMI-25]; /healthz probes the DB with a 2s timeout [HOMI-27]
- Integration suite 16 -> 26 tests across three files; runs with and without REDIS_URL; CI integration job gained a Redis service container
- Review gate ran inline (cloud agents unavailable): fixed a WS-path 500-instead-of-404 bug, a stale-Redis-client hazard, limiter eviction, and four deduplications

## Done (Code review + hardening, 2026-07-08)

- Independent agent code review of Sprints 1-2; findings fixed same day (commit `f8dfdc1`)
- CRITICAL: idempotency replay now scoped to (key, user, endpoint) with request-hash mismatch = 409; was leaking other users' stored responses cross-house
- CRITICAL: ledger is enforced single-currency per house; balances can no longer net mixed currencies
- HIGH: prod refuses to boot without BETTER_AUTH_SECRET; magic-link URLs never logged in prod; payment amounts bounded; one shared pg pool drained on shutdown
- Migration `0002_review_hardening`: hot-path indexes + CHECK constraints (positive amounts, distinct payment parties, invite use caps, room weight range)
- Integration suite grown to 16 tests incl. concurrent same-key race and DB-level split-sum assertion; deferred findings filed as HOMI-24..27

## Done (Sprint 2, 2026-07-07)

- Better Auth: magic-link sign-in, cookie sessions and identities in our Postgres, Apple/Google config-gated behind env vars; dev `x-user-id` shim fully removed [HOMI-2]
- Invite links: admin-created `homi.app/j/<token>`, token hashed at rest, atomic accept with returning-member reactivation [HOMI-8]
- Rooms with weight basis points; room-weighted splits derived server-side, clients cannot supply weights [HOMI-10]
- Settlement payments: idempotent single-sided recording, recipient-only dispute inside a server-enforced 72h window, disputed payments drop out of balances [HOMI-11]
- Integration suite (10 tests) now authenticates through the real magic-link flow end to end

## Done (Sprint 1, 2026-07-07)

- Monorepo scaffold: npm workspaces, strict TS, eslint, docker-compose (Postgres/Redis/MinIO) [HOMI-1]
- Agile artifacts: product backlog (HOMI-1..20), Sprint 1 plan + retro, Definition of Done (`docs/agile/`)
- `packages/domain`: pure split math (equal/exact/percent/room-weighted, integer cents, remainder to payer) and the single balance function; 15 unit tests incl. property-based [HOMI-5]
- `packages/db`: Drizzle schema for R1 core (identity, houses, ledger, idempotency, activity feed) + checked-in migration [part of HOMI-6]
- `apps/api`: create house, add member (interim), idempotent transactional expense creation, balances endpoint, per-request house-membership guard; 7 integration tests against real Postgres [HOMI-3, HOMI-6, HOMI-7]
- `apps/worker`: boot skeleton with day-one job safety rules documented
- CI/CD: GitHub Actions (typecheck/lint/unit, integration vs Postgres 16, migration drift check, Docker build) + multi-stage Dockerfile; first run green [HOMI-4]

## Next steps and what to be mindful of

1. **Sprint 4 opener (retro action): recurring bills (HOMI-13), hazards first.**
   Unique key on (template_id, period) so re-runs never double-post rent (H4); all scheduling computed server-side in the house timezone (H5).
   The worker gets its first real job here; publish its events through the same Redis bus the gateway already consumes.
2. **Refactor queued with the next ledger story:** derive realtime hints from the activity_events write that already happens inside every transaction, instead of hand-placed publish calls per service method.
3. **Debt to carry consciously:** magic-link emails are only logged until HOMI-21 (email provider); legacy auth tables await the HOMI-22 contract migration; shared rooms are HOMI-23; idempotency-key retention is HOMI-26.
4. **HOMI-14 Cloud Run deploy.**
   CI deploy jobs are placeholders gated on `GCP_WORKLOAD_IDENTITY_PROVIDER`; needs GCP project + Workload Identity setup.
   Note: production now requires REDIS_URL (realtime fan-out and rate limits refuse the in-process fallback) and BETTER_AUTH_SECRET.
5. **Process:** the agent code review stays the standing gate at each sprint close; Sprint 3's ran inline (cloud agents unavailable) and still caught a real 500-instead-of-404 bug.
6. **Every money mutation stays idempotent and transactional (H1); the Definition of Done is the checklist, not a suggestion.**
7. **Local dev quirk:** this Mac has no Docker daemon; integration tests run against Homebrew `postgresql@15` (scratch cluster on port 5433) plus Homebrew `redis` for the Redis-backed path, or in CI.
8. **R1 discipline:** R2-R4 are hypothesis backlog; if money retention is weak, fix money, do not start chores.
