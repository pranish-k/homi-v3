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

## Progress log

**2026-07-19, carryovers done:** all four structural carryovers landed via the first PR-based merge (branch `sprint6-carryovers`, rebase-merged, CI green on main at `310f9da`):
one DbConn/Tx in @homi/db, requireAdmin/activeMemberRole in auth/house-role.ts, lockActingMember in @homi/ledger (SHARE-locked bill-owner and payment-recipient guards), and participant-scoped lockActiveMembers (room_weighted keeps the full-house read).
Suite green: 34 unit + 53 API + 10 worker.
**Workflow decision:** trunk-based with short-lived branches and PRs from now on; rebase-merge for curated commit stacks, squash otherwise; merge on green CI, no human-approval requirement; prod stays tag-triggered.

**2026-07-19, GCP foundation done (project `homi-testflight`, number 528839783533, region us-east4):**
APIs enabled (run, sqladmin, secretmanager, artifactregistry, iamcredentials, sts); billing is linked.
Artifact Registry docker repo `homi` in us-east4.
Service accounts: `github-deployer@` (roles/run.admin, artifactregistry.writer, cloudsql.client, and serviceAccountUser on the runtime SA) and `homi-runtime@` (cloudsql.client, secretmanager.secretAccessor) for the Cloud Run services.
Workload Identity Federation: pool `github`, provider `github-actions`, locked to `assertion.repository == 'pranish-k/homi-v3'`; github-deployer bound via workloadIdentityUser.
Secret Manager: `resend-api-key` (Resend account created) and `better-auth-secret` (generated) each at version 1.

**Decision (2026-07-19, Pranish):** Cloud SQL on db-f1-micro (~$11/mo) and Redis on the Upstash free tier (public TLS endpoint, no VPC connector).
Provisioning is unblocked.

**2026-07-20, Cloud SQL provisioned:** instance `homi-db` (Postgres 16, db-f1-micro, ENTERPRISE edition, us-east4-c, 10GB SSD auto-increase, IAM auth on, public IP with zero authorized networks - Cloud Run will connect via the Auth Proxy socket).
Databases `homi_staging` + `homi_prod` with users `app_staging`/`app_prod` (schema privileges + default privileges granted).
Connection URLs stored as secrets `database-url-staging`/`database-url-prod`; `homi-runtime@` granted accessor.
Full reference (IPs, connection name, console links, maintenance-access recipe) in `docs/infra/GCP.md`.

**2026-07-21, Redis provisioned:** Upstash free-tier database `usable-burro-43331` (TLS), URL stored as secret `redis-url`, runtime SA granted accessor; PING verified from local.
One database shared by staging and prod for now - split into two before real prod traffic (caveat recorded in `docs/infra/GCP.md`).
Provisioning is complete; HOMI-14 CI/Cloud Run is next.

**2026-07-21, HOMI-14 staging is LIVE:** the deploy pipeline is real (reusable `deploy.yml` called from ci.yml: WIF auth, image build+push, migrations through the Cloud SQL Auth Proxy pre-traffic, api+worker Cloud Run deploys, `/readyz` smoke gate).
`homi-api-staging` serves `{"status":"ok"}` on `/readyz` at https://homi-api-staging-528839783533.us-east4.run.app; `homi-worker-staging` runs in the new `WORKER_MODE=http` with Cloud Scheduler POSTing `/tick` per minute + `/prune` hourly via OIDC (verified 200) - chosen over the poll loop because always-allocated CPU costs ~$60/mo.
Three deploy-shakeout fixes landed via PRs along the way: caller jobs must grant `id-token: write` to a reusable workflow; the runtime image must carry workspace-nested node_modules (better-auth was nested under apps/api, MODULE_NOT_FOUND at boot - a class local checkouts can never catch); `/healthz` is a GFE-reserved path on run.app domains so the smoke gate probes `/readyz`.
First fully green end-to-end deploy run on main: 2026-07-21.
Remaining for HOMI-14: prod first-tag deploy + its Scheduler jobs at sprint close.
**Still to do:** provision Cloud SQL + Redis, real steps for the two stubbed CI deploy jobs (staging on main, prod on tags, migrations as a pre-traffic release step), Cloud Run services for API + worker, HOMI-21 Resend send hook, Sentry slice, then the HOMI-30 stretch (Expo scaffold).

## Sprint review notes (filled at close)

## Retrospective
