# Sprint 1 (weeks 1-2 of R1)

**Sprint goal:** a walking skeleton of the Money Core.
A developer can clone the repo, boot the stack, create a house, post an idempotent expense with correct split math, and read server-computed balances, with CI proving all of it on every push.

**Dates:** 2026-07-07 to 2026-07-18.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-1 | Monorepo scaffold: workspaces, tooling, Docker dev env | 5 |
| HOMI-5 | Pure split math with property-based tests (H3) | 5 |
| HOMI-3 | Create house + membership (dev auth shim until HOMI-2) | 3 |
| HOMI-6 | Idempotent, transactional expense creation (H1) | 8 |
| HOMI-7 | Single balance function + balances endpoint | 5 |
| HOMI-4 | CI pipeline: typecheck, lint, unit + integration tests, migration dry-run, build | 5 |

Committed: 31 points.

## Explicitly out of scope this sprint

Real auth (HOMI-2 replaces the dev `x-user-id` shim in Sprint 2).
Invites, placeholders, rooms, payments, recurring bills, realtime, push.

## Sprint review notes (filled at close)

All six committed stories done; see git history for the increment.
Unit suite includes property-based tests over split math (splits always sum to the total, remainder is deterministic).
Integration suite runs in CI against ephemeral Postgres 16 and covers idempotency replay and cross-house authorization denial.

## Retrospective

**Went well:** pure-domain package (`packages/domain`) kept money math testable without any infrastructure; CI was green from the first push of the pipeline.
**Needs improvement:** the dev auth shim leaks into route handlers; HOMI-2 must remove it behind a single guard so no handler ever reads the header directly.
**Action:** Sprint 2 starts with HOMI-2 (Better Auth) before any new ledger surface.
