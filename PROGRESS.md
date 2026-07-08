# HOMI v3 Progress

**Last updated:** 2026-07-08 (post-review hardening)
**Phase:** R1 Money Core (weeks 1-12, committed scope)
**Repo:** https://github.com/pranish-k/homi-v3 · tag `v0.2.0-sprint2` + review fixes (`f8dfdc1`) · CI: green

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

1. **Sprint 3 opener (retro action): realtime and the HOME snapshot (HOMI-17, HOMI-20).**
   Realtime events are cache-invalidation hints only, never the data itself (H6).
2. **Debt to carry consciously:** magic-link emails are only logged until HOMI-21 (email provider); legacy auth tables await the HOMI-22 contract migration; shared rooms (two occupants) are HOMI-23; review deferrals HOMI-24..27 (rate limiting on auth/invites, single-snapshot balance reads, idempotency-key retention, DB-touching health check).
   Rate limiting (HOMI-24) matters most: the magic-link endpoint is an unauthenticated email-send loop.
3. **Process:** run an agent code review as a standing gate at each sprint close; this one caught two criticals the DoD's "reviewed" line would otherwise have waved through.
4. **HOMI-14 Cloud Run deploy.**
   CI deploy jobs are placeholders gated on `GCP_WORKLOAD_IDENTITY_PROVIDER`; needs GCP project + Workload Identity setup.
5. **Recurring bills (HOMI-13) carry the sharpest hazards:** unique key on (template_id, period) so re-runs never double-post rent (H4), and all scheduling in the house timezone server-side (H5).
6. **Every money mutation stays idempotent and transactional (H1); the Definition of Done is the checklist, not a suggestion.**
7. **Local dev quirk:** this Mac has no Docker daemon; integration tests run against Homebrew `postgresql@15` (scratch cluster on port 5433) or in CI.
8. **R1 discipline:** R2-R4 are hypothesis backlog; if money retention is weak, fix money, do not start chores.
