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

## Retrospective
