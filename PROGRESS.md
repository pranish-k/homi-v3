# HOMI v3 Progress

**Last updated:** 2026-07-07 12:05 (Sprint 1 close)
**Phase:** R1 Money Core (weeks 1-12, committed scope)
**Repo:** https://github.com/pranish-k/homi-v3 · tag `v0.1.0-sprint1` · CI: green

## Done (Sprint 1, 2026-07-07)

- Monorepo scaffold: npm workspaces, strict TS, eslint, docker-compose (Postgres/Redis/MinIO) [HOMI-1]
- Agile artifacts: product backlog (HOMI-1..20), Sprint 1 plan + retro, Definition of Done (`docs/agile/`)
- `packages/domain`: pure split math (equal/exact/percent/room-weighted, integer cents, remainder to payer) and the single balance function; 15 unit tests incl. property-based [HOMI-5]
- `packages/db`: Drizzle schema for R1 core (identity, houses, ledger, idempotency, activity feed) + checked-in migration [part of HOMI-6]
- `apps/api`: create house, add member (interim), idempotent transactional expense creation, balances endpoint, per-request house-membership guard; 7 integration tests against real Postgres [HOMI-3, HOMI-6, HOMI-7]
- `apps/worker`: boot skeleton with day-one job safety rules documented
- CI/CD: GitHub Actions (typecheck/lint/unit, integration vs Postgres 16, migration drift check, Docker build) + multi-stage Dockerfile; first run green [HOMI-4]

## Next steps and what to be mindful of

1. **HOMI-2, Better Auth (Sprint 2 opener, retro commitment).**
   The dev `x-user-id` shim must be removed behind one guard; no handler may ever read that header directly, and `DEV_AUTH_ENABLED` must never reach a deployed env.
2. **HOMI-8 invites, HOMI-10 rooms, HOMI-11 payments + 72h dispute window.**
   Payments must feed the existing single balance function, not a second computation.
3. **HOMI-14 Cloud Run deploy.**
   CI deploy jobs are placeholders gated on `GCP_WORKLOAD_IDENTITY_PROVIDER`; needs GCP project + Workload Identity setup.
4. **Recurring bills (HOMI-13) carry the sharpest hazards:** unique key on (template_id, period) so re-runs never double-post rent (H4), and all scheduling in the house timezone server-side (H5).
5. **Every money mutation stays idempotent and transactional (H1); the Definition of Done is the checklist, not a suggestion.**
6. **Local dev quirk:** this Mac has no Docker daemon; integration tests run against Homebrew `postgresql@15` (scratch cluster on port 5433) or in CI.
7. **R1 discipline:** R2-R4 are hypothesis backlog; if money retention is weak, fix money, do not start chores.
