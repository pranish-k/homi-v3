# Sprint 6 (weeks 11-12 of R1)

**Sprint goal:** the money core gets a real address, and the path to a phone opens.
By sprint end the API runs on Cloud Run behind a real URL, magic links arrive in real inboxes, errors surface in Sentry, and the four structural review carryovers are paid so the client sprints build on one implementation of each money invariant.
This is the foundation sprint for TestFlight v1 (decided 2026-07-19): a five-screen client shipping the expense loop only - sign in, create/join house, HOME, add expense, settle up - with everything else the backend already supports staying hidden until a later build surfaces it.

**Dates:** 2026-09-14 to 2026-09-25.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-14 | Staging deploys to Cloud Run automatically from main; prod from tagged releases | 8 |
| HOMI-21 | Magic-link and notification emails delivered via a transactional email provider | 3 |
| HOMI-15a | Sentry wired into API and worker (the observability slice beta needs; dashboards stay HOMI-15) | 2 |

Committed: 13 points, plus the four structural carryovers from the Sprint 5 review (sized together like a 5-point story):
the placeholder cannot-act guard moves into @homi/ledger with the core's lock discipline (replacing three unlocked hand-rolled copies),
lockActiveMembers scopes down to participants+payer for equal/exact/percent modes (room_weighted keeps the full occupant set; closes the claim-starvation risk),
a shared requireAdmin helper (replacing four copies of the active-admin gate),
and one drizzle connection type exported from @homi/db (replacing LedgerConn/DbConn/Tx).

**Stretch (pull only if the committed set is done):** HOMI-30, Expo app scaffold + EAS build + internal TestFlight track (5 points) - it front-runs Sprint 7.

## Notes going in

- Accounts exist (GCP project and Apple developer account confirmed 2026-07-19); the remaining human step is choosing and creating the email provider account (Resend recommended: fastest to a working sender) and a sending domain.
- Carryovers land first, same discipline as Sprint 5: they are small, they touch the money paths the deploy will freeze into a release, and the client sprints must not build on three copies of anything.
- Deploy order: gcloud + Workload Identity Federation for GitHub Actions, Cloud SQL (Postgres 16) + Memorystore Redis, secrets in Secret Manager, then the two CI deploy jobs that have been stubbed since Sprint 1 gain real steps.
  Production refuses to boot without REDIS_URL and BETTER_AUTH_SECRET (Sprint 3 hardening) - the deploy inherits those guarantees, it does not relax them.
- Migrations run as a release step against Cloud SQL before traffic shifts, same expand-migrate-contract discipline; the CI drift check already proves main matches the migration set.
- Email lands behind the existing logger seam: the provider client implements the same send hook Better Auth already calls, so dev keeps logging links and staging/prod send real mail; INVITE_LINK_ORIGIN points at the deployed URL.
- Sentry is the 2-point slice of HOMI-15: error capture + release tagging in API and worker, nothing more; OpenTelemetry dashboards stay backlogged until there is traffic worth graphing.
- TestFlight v1 scope is pinned in the backlog as epic E6 (HOMI-30..35) so client work starts from written stories, not vibes: scaffold, auth, house join, HOME, add-expense (the under-15-seconds flow), settle.
  Bills, rooms, placeholders, edits, and disputes stay server-side and UI-hidden in v1; each is a later build's headline.
- Not this sprint, consciously: HOMI-18/19 (nudges, digest) now have their delivery channel but wait for the client beta to exist; R2 stays untouched per R1 discipline.
- Process gate stands: independent code review before tagging the sprint close.

## Sprint review notes (filled at close)

## Retrospective
