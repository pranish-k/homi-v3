# HOMI v3 Progress

**Last updated:** 2026-07-21 (Sprint 6 closed: all three committed stories done, prod is live).
**Phase:** R1 Money Core (weeks 1-12, committed scope).
**Repo:** https://github.com/pranish-k/homi-v3 · latest tag `v0.6.0-sprint6`.
Full detail per sprint lives in `docs/agile/SPRINT_*.md`; infrastructure reference in `docs/infra/GCP.md`.

## Sprint 6 (2026-07-19 to 2026-07-21, closed `v0.6.0-sprint6`) - all committed stories done, prod live

- Direction: TestFlight v1 ships the expense loop only (epic E6, HOMI-30..35); everything else stays server-side and UI-hidden until later builds.
- Workflow: trunk-based, short-lived branches + PRs, merge on green CI; prod deploys are tag-triggered.
- Done: the four Sprint 5 structural carryovers (one DbConn/Tx, shared requireAdmin, locked cannot-act guard in @homi/ledger, participant-scoped member locks).
- Done: HOMI-14 - Cloud Run deploy pipeline; main pushes deploy staging automatically (WIF auth, image push, migrations through the Cloud SQL Auth Proxy pre-traffic, api + worker deploys, /readyz gate); prod is tag-triggered.
  Staging API: https://homi-api-staging-528839783533.us-east4.run.app; worker is Scheduler-driven (`WORKER_MODE=http`, tick per minute, prune hourly) so it scales to zero.
- Done: HOMI-21 - magic links send as real mail via Resend from verified domain `contact.homiapp.app`; dev keeps the logged-link seam; prod refuses to boot without RESEND_API_KEY; verified end to end into a real inbox.
- Done: HOMI-15a - Sentry error capture + release tagging in API and worker, config-by-presence (off without SENTRY_DSN, never fails boot); API interceptor reports only 5xx, worker reports tick/prune failures; live on staging (secret `sentry-dsn`, release = commit SHA, environment tag), delivery verified end to end.
- Done: pre-tag code review (8 findings) - 7 fixed across four area-grouped PRs (worker outcome/shutdown/teardown, magic-link 503, posting-problem helper, deploy inputs); Dockerfile nested-node_modules band-aid (#5) deferred as debt (needs a Docker-capable env to verify).
- Done: first prod deploy (tag `v0.6.0-sprint6`) - `homi-api` (https://homi-api-ko63dsolia-uk.a.run.app, `/readyz` 200) and `homi-worker` created, migrations ran against the empty `homi_prod`, both on revision `00001` at 100% traffic; prod Scheduler jobs (`homi-worker-tick` per minute, `homi-worker-prune` hourly at :07) created and verified 2xx after the `run.invoker` grant propagated.
- Next up: optional HOMI-30 Expo scaffold stretch, then Sprint 7 planning.
- Deferred: DMARC record on contact.homiapp.app before outside testers (mail currently lands in the inbox, so not blocking own-house testing); split Upstash Redis into staging/prod before real prod traffic; Dockerfile nested-node_modules band-aid (review finding #5).

## Done, newest first

- **Sprint 5** (closed 2026-07-19, `v0.5.0-sprint5`): placeholder roommates with one-transaction claim [HOMI-9], shared-room weight splitting in the core [HOMI-23], legacy auth tables dropped [HOMI-22], plus the Sprint 4 carryovers (UUID pipe, withIdempotency, @homi/ledger posting core).
  Review gate confirmed ten findings; six correctness bugs fixed pre-tag, the worst three in rare branches of the claim path.
- **Sprint 4** (closed 2026-07-14, `v0.4.0-sprint4`): recurring bills with hazard-first schedule math [HOMI-13], full-respec expense edits with revision snapshots [HOMI-12], recipient-only dispute resolution [HOMI-29], idempotency-key pruning [HOMI-26], ActivityService-derived realtime hints.
  Review gate: zero correctness bugs, ten cleanups applied.
- **HOMI-28** (2026-07-13): sign-up name capture + per-house display_name endpoint.
- **Sprint 3** (closed 2026-07-08, `v0.3.0-sprint3`): HOME snapshot [HOMI-20], realtime WS hints with Redis fan-out [HOMI-17], keyset ledger [HOMI-16], rate limits [HOMI-24], snapshot-read balances [HOMI-25], health probes [HOMI-27].
  Post-sprint multi-agent review (2026-07-09) fixed two criticals (WS upgrade-socket crash, shutdown deadlock) and four highs.
- **Sprint 2** (closed 2026-07-07, `v0.2.0-sprint2`): Better Auth magic-link sessions [HOMI-2], hashed invite links [HOMI-8], weighted rooms [HOMI-10], settlement payments with 72h dispute window [HOMI-11].
  Post-sprint review (2026-07-08) fixed two criticals (cross-user idempotency replay leak, currency mixing) and hardening highs.
- **Sprint 1** (closed 2026-07-07, `v0.1.0-sprint1`): monorepo scaffold, split/balance math with property tests [HOMI-5], R1 schema [HOMI-6], first API slice [HOMI-3/7], worker skeleton, CI with integration tests and migration drift check [HOMI-4].
- **Demo detour** (2026-07-11, branch `demo/web`, never merges): throwaway Vite SPA against the local API; the click-through surfaced HOMI-28/29.

## Standing reminders

1. Every money mutation stays idempotent and transactional (H1); the Definition of Done is the checklist, not a suggestion.
2. The agent code review is the standing gate at each sprint close; every run so far caught real bugs.
3. Retro lesson: hazard-first design needs hazard-first tests, branch by branch - Sprint 5's serious bugs sat in designed-but-untested rare branches.
4. Production refuses to boot without REDIS_URL, BETTER_AUTH_SECRET, and RESEND_API_KEY; deploys inherit these guarantees.
5. Known debt: two rooms cannot merge when a roomed member claims a roomed placeholder (documented in acceptInvite); staging and prod share one Upstash Redis until real prod traffic; Dockerfile carries a hand-maintained per-workspace nested-node_modules copy (review finding #5, deferred - needs a Docker env to fix safely).
6. Local dev: no Docker; Homebrew postgresql@15 on port 5433 + Homebrew redis; `DATABASE_URL=postgres://homi@localhost:5433/homi npm run test:integration`.
7. R1 discipline: R2-R4 are hypothesis backlog; if money retention is weak, fix money, do not start chores.
