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

All three committed stories done plus the three structural carryovers: 11 points and the ~5-point refactor block.
The carryovers landed first, in the planned dependency order.
The route-param UUID pipe (`apps/api/src/lib/uuid.pipe.ts`) closes the three-times-fixed cast-500 class at the boundary, with the Idempotency-Key header validated the same way.
`withIdempotency` makes every idempotency-keyed mutation H1 by construction: the wrapper owns the replay lookup, the store-inside-transaction, and the replay-after-losing-a-race; four endpoints shed their copies.
`@homi/ledger` owns member locking, split resolution, and expense insertion; API expense create/edit and the worker's bill posting all post through it, so who-owes-what cannot drift between consumers.
HOMI-23 landed on the core as planned: `divideRoomWeight` divides a room's weight evenly across occupants with the remainder basis point pinned to the earlier-joined occupant, property-tested in the domain package, and the 10000bp invariant stays checked in computeSplits.
HOMI-9 landed hazards-first per the standing retro action: placeholders owe but can never act (payer, payment party, and bill owner all refuse them), the claim is one transaction under FOR UPDATE on the placeholder's membership row, expense resolution SHARE-locks participant rows so an edit and a claim serialize, racing claimers resolve to exactly one winner, and split merges fold a returning member's share without changing any expense total.
HOMI-22 dropped `auth_identities`, `sessions`, and `users.avatar_path` in migration 0006 after grep confirmed zero readers since HOMI-2; the expand-migrate-contract loop that opened in Sprint 2 is closed.
The integration suite grew from 51 to 63 tests (53 API + 10 worker), green on typecheck, lint, and both suites.

The review gate ran 2026-07-19 (8 finder angles, then one verifier per surviving candidate): ten findings survived verification, six of them correctness bugs, all fixed before tagging.
The three worst lived in the claim path's rare branches: a claimer who was already an active member never inherited the placeholder's room (orphaning it and breaking every room-weighted posting house-wide), the same accept losing a concurrent membership-insert race double-logged member.joined and misreported alreadyMember, and the claim's split fold changed a visible per-line amount with no expense_revisions snapshot or feed event (HOMI-12 bypass).
Also fixed: GET /rooms still returned one row per occupant after HOMI-23 made rooms shareable (now one row per room with userIds), placeholder creation had no rate limit while its sibling invite routes did, and createInvite validated the placeholder outside any lock so a race could bind an invite to an already-claimed placeholder.
Each fix carries a regression test.
Four structural findings carry to Sprint 6: the placeholder cannot-act guard exists as three unlocked hand-rolled copies and belongs in @homi/ledger with the core's lock discipline, `lockActiveMembers` SHARE-locks the whole house when equal/exact/percent postings only need participants (a claim-starvation risk under posting traffic), the active-admin check is copy-pasted across four services and wants a shared requireAdmin, and the drizzle connection type is defined three times (LedgerConn, DbConn, Tx) and wants one home in @homi/db.

## Retrospective

**Went well:** refactors-before-features paid off exactly as planned; HOMI-23's weight derivation and HOMI-9's guards were written once against the shared core, and the worker inherited both for free.
Designing HOMI-9 from the hazard list meant the hard part (two claimers, edit-versus-claim races, the fold) had answers before code, and the racing-claimers integration test pinned H11 for good.
The review gate earned its keep again: six real correctness bugs found and fixed before the tag, where Sprint 4's diff had zero.
**Needs improvement:** all three serious bugs sat in the claim path's rare branches (already-a-member, lost insert race), which the feature work designed for but never tested; hazard-first design needs hazard-first tests, branch by branch, not just the headline race.
Locking scope was decided implicitly (whole house instead of participants) and the review had to surface the contention cost; lock-scope choices in shared cores deserve an explicit note at design time.
**Action:** Sprint 6 opens with the four structural carryovers so the money paths keep one implementation of each invariant.
HOMI-14 + HOMI-21 (deploy + email) stay blocked on accounts and travel together when unblocked; HOMI-18/19 wait behind that delivery channel.
