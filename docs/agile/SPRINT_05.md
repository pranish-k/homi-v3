# Sprint 5 (weeks 9-10 of R1)

**Sprint goal:** the house exists before everyone is in it, and the codebase stops letting money paths drift.
A member can log expenses against a placeholder roommate from day one; when the real person joins through their invite, they claim that history in one atomic step (H11) and review a transparent breakdown, never a bill compiled behind their back.
Under it, the three structural findings the Sprint 4 review queued land first, so the sprint's features are born on them.

**Dates:** 2026-08-31 to 2026-09-11.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-9 | Log expenses against a placeholder roommate who later claims their history atomically (H11) | 8 |
| HOMI-23 | A room shared by a couple splits its weight across both occupants | 2 |
| HOMI-22 | Drop the legacy hand-rolled auth tables (contract phase of the HOMI-2 migration, H7) | 1 |

Committed: 11 points, plus the three structural carryovers from the Sprint 4 review (sized together roughly like a 5-point story):
the route-param UUID validation pipe (closes the three-times-fixed cast-500 class at the boundary layer),
the higher-order idempotency wrapper (H1 by construction instead of by copy-paste),
and the shared posting core so worker and API money logic cannot drift.

## Notes going in

- Refactors land first, in dependency order: pipe, idempotency wrapper, posting core.
  HOMI-23 then lands ON the posting core (occupant-weight derivation is exactly the logic that must not fork between API and worker), and HOMI-9's guards are written against the shared core once, not twice.
- HOMI-9 starts from the hazards (H11), per the standing retro action:
  - Claiming is one atomic, guarded operation: the placeholder's membership row is locked FOR UPDATE, checked unclaimed, history reassigned, membership handed over, and the invite use consumed in ONE transaction.
  - Two people claiming the same placeholder: the second accept fails loudly with a clear error, and the admin issues a fresh plain invite; silently joining without the promised history would be worse than the error.
  - A placeholder edited into expenses mid-claim: split resolution takes SHARE locks on the participant membership rows, so an edit and a claim serialize instead of stranding an orphaned split.
  - Placeholders owe shares but never act: no email, no session, never `paid_by`, never a payment party, never a bill owner - enforced at the shared core and at payment recording, so the claim never has to rewrite anything but splits.
  - Split reassignment merges: if the claimer already has a split in the same expense (a returning member who left history behind), the placeholder's share folds into theirs; amounts never change, only whose name is on them (this is re-identification, not a money edit, so invariant 1 stands).
- The invite carries the claim: `invites.placeholder_user_id` (expand-only migration) binds an invite to a placeholder at creation; the existing atomic accept grows the claim branch.
  The invite framing stays "review and approve your share" (D11): the claimer inherits the placeholder's room and their line items are all individually disputable through the ledger they just inherited.
- HOMI-23 derivation is deterministic: a room's weight divides evenly across its occupants, remainder basis points to the earlier-joined occupant, and the per-house 10000bp invariant is checked where it always was (computeSplits).
- HOMI-22 is the contract step of an expand-migrate-contract that expanded in Sprint 2: `auth_identities`, `sessions`, and `users.avatar_path` have had no readers or writers since HOMI-2 landed; grep confirms before the migration drops them.
- Not this sprint, consciously: HOMI-14 (Cloud Run) and HOMI-21 (email provider) travel together and are blocked on accounts that do not exist yet (GCP project, email provider); HOMI-18/19 (nudges, digest) want a delivery channel, which is the same blocker.
- Process gate stands: independent code review before tagging the sprint close.

## Sprint review notes (filled at close)

## Retrospective
