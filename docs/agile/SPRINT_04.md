# Sprint 4 (weeks 7-8 of R1)

**Sprint goal:** money moves on its own schedule, and history stops being write-once.
Rent and other recurring bills post themselves on their due date in the house timezone, exactly once per period, even if the worker crashes and re-runs; a member can fix a mistyped expense without losing the original; and a disputed payment has a way forward instead of a dead end.

**Dates:** 2026-08-17 to 2026-08-28.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-13 | Recurring bills auto-post on their due date in the house timezone, exactly once per period (H4, H5) | 8 |
| HOMI-12 | Edit an expense; the previous version is kept as a revision and the house is notified | 5 |
| HOMI-29 | Resolve a disputed payment: recipient-only, confirm (counts again) or stand firm (payer re-records) | 5 |

Committed: 18 points.

**Stretch (pull only if the committed set is done):** HOMI-26, idempotency-key pruning worker job (2 points) - it rides on the worker infrastructure HOMI-13 builds anyway.

## Notes going in

- HOMI-13 starts from the hazards, per the Sprint 3 retro action, not from the feature.
  The unique key on (template_id, period) goes into the first migration, so a crashed or re-run posting job can never double-post rent (H4); the posting write is an ordinary idempotent, transactional ledger insert (H1) that trips on that key.
- All schedule computation is server-side in the house timezone (H5): due dates, period boundaries, and the DST edges where a wall-clock due time does not exist or exists twice.
  Period identity (what makes two posting attempts "the same period") must be a pure, unit-tested function before any worker code exists.
- HOMI-13 gives the worker its first real job.
  The worker publishes through the same Redis bus the gateway already consumes; nothing about fan-out is worker-special.
- The queued refactor lands inside whichever of HOMI-13/HOMI-12 touches the ledger service first: realtime hints derive from the activity_events write that already happens inside every mutation's transaction, replacing the hand-placed publish call per service method.
  After it, a mutation that writes its activity event gets its hint for free, and a mutation that forgets the event fails review on the missing feed entry, not on a missing publish.
- HOMI-12 keeps revisions append-only: an edit inserts a revision row and updates the head, in one transaction, with splits revalidated against the same domain function as creation (invariant 3 stays the only balance math).
- HOMI-29 semantics were decided 2026-07-13: only the recipient can resolve, mirroring HOMI-11's single-sided philosophy (the protected party holds the pen).
  Confirm flips disputed -> resolved and the payment counts in balances again (computeBalances already handles the status); stand firm is a no-op - the payment stays disputed and the payer re-records correctly.
  The state transition is guarded in SQL like the dispute itself: UPDATE ... WHERE status = 'disputed', under a row lock.
- Migrations follow expand-migrate-contract (H7); the bill template tables are pure expansion, so this sprint has no contract step.
- Not this sprint, consciously: HOMI-21 (email provider) still waits on a deploy target (HOMI-14); HOMI-9 (placeholder roommates) stays queued - it is 8 points and deserves a sprint where it is the centerpiece.
- Process gate stands: independent agent code review before tagging the sprint close.

## Sprint review notes (filled at close)

All three committed stories done, plus the HOMI-26 stretch: 20 points.
HOMI-13 landed hazards-first as planned: migration 0004 created the partial unique index on (template_id, period) and the pure schedule math (nextDueDate with monthly clamping and 'last', weekly weekdays, periodKey, todayInTimezone) shipped with 13 domain tests including property tests before any worker code existed.
The worker's postDueBills polls active templates every 60 seconds and posts each due period as an ordinary expense in one transaction; H4 is the database's guarantee, not the scheduler's - a re-run, a crashed run resumed, or a second worker instance trips the unique index, heals next_run, and moves on.
Due-ness is the house-local DATE (H5), which sidesteps DST wall-clock hazards entirely; the Kiritimati-vs-New-York test pins the boundary.
Bills that cannot post (owner left, vacant room breaking the weight sum, broken timezone) pause with a bill.paused feed event instead of hot-looping; resuming recomputes next_run so paused periods are consciously skipped, never back-posted.
The API grew POST/GET/PATCH bills endpoints (idempotency-keyed create, owner-or-admin pause/resume) limited to equal and room_weighted modes; participants derive at posting time.
The queued refactor landed first, so every new mutation was born on it: ActivityService.transact writes the feed event and publishes its hint after commit, replacing hand-placed publish calls at what were six drift-prone call sites.
HOMI-12: PUT /v1/expenses/:expenseId snapshots the previous expense fields AND splits into expense_revisions in the same transaction, recomputes splits through the same resolveSplits path as creation, and notifies via expense.edited.
HOMI-29: POST /v1/payments/:paymentId/resolve, recipient-only, SQL-guarded disputed -> resolved; computeBalances already counted resolved, so the whole story was one guarded state transition plus tests.
HOMI-26 (stretch): hourly worker pass deletes idempotency keys past a 30-day window, batched, refusing nonsensical windows.
The integration suite grew from 32 to 51 tests (41 API + 10 worker; the worker workspace got its own vitest harness seeding Postgres directly), all passing with and without REDIS_URL; the CI migration drift check passes.

Review gate ran twice: an inline pass found and fixed one real bug class - HouseMemberGuard accepted non-UUID houseIds and every house-scoped HTTP route turned a garbage id into a Postgres cast error 500 (the same class the Sprint 3 review fixed on the WS path); payment and bill entity routes gained the same guard.
The multi-agent review then ran (8 finder angles + verification): zero correctness bugs survived; of ten cleanup findings, the mechanical ones were applied before tagging (shared isUniqueViolation in @homi/db, shared RealtimeHint type in @homi/domain, isoAddDays moved to the domain schedule module, a next_run SQL bound so the due-scan rides its partial index, a loop-invariant hoist, a forwarding wrapper and a dead test variable removed) and the structural ones carry to Sprint 5 (idempotency higher-order wrapper, shared posting core for worker + API, the route-param UUID pipe already in the retro action).

## Retrospective

**Went well:** hazards-first ordering meant the unique key and the schedule math existed and were tested before the worker was written, so the worker's failure paths were designed against real guarantees; landing the activity-events refactor before the sprint's features meant every new mutation used the one publish mechanism from birth; giving the worker its own integration harness (direct Postgres seeding, no HTTP) kept its tests fast and honest.
**Needs improvement:** the UUID-cast bug class has now been fixed three times in three shapes (WS path, entity routes, house guard); the lesson is that validation belongs at the boundary layer by default, not per-route as each review finds one.
**Action:** Sprint 5 should open with HOMI-9 (placeholder roommates) as the centerpiece it deserves, and HOMI-21/HOMI-14 (email + deploy) should travel together since email delivery is what blocks real invites in a deployed environment; consider a route-param validation pipe so the UUID class is closed for good.
