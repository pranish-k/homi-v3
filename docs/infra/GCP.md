# GCP infrastructure reference (project: homi-testflight)

Living reference for what exists in GCP.
No secrets in this file - passwords and API keys live only in Secret Manager.

- **Project:** `homi-testflight` (number 528839783533)
- **Region:** us-east4
- **Console:** https://console.cloud.google.com/welcome?project=homi-testflight

## Cloud SQL (provisioned 2026-07-20)

- **Instance:** `homi-db` - Postgres 16, db-f1-micro, ENTERPRISE edition, zonal (us-east4-c), 10GB SSD with auto-increase, IAM auth enabled
- **Public IP:** `35.194.65.177` (authorized networks: none - locked down; Cloud Run connects via the Cloud SQL Auth Proxy socket, not this IP)
- **Connection name:** `homi-testflight:us-east4:homi-db` (this is what Cloud Run's `--add-cloudsql-instances` and the proxy use)
- **Databases:** `homi_staging`, `homi_prod`
- **App users:** `app_staging`, `app_prod` - each has USAGE+CREATE on its database's `public` schema plus default privileges on future tables/sequences
- **Root user:** `postgres` (password in no file - reset via `gcloud sql users set-password postgres --instance=homi-db --password=...` if ever needed)
- Console: https://console.cloud.google.com/sql/instances/homi-db/overview?project=homi-testflight

To connect from this Mac for maintenance: temporarily authorize your IP, then remove it after:

```sh
MYIP=$(curl -s https://api.ipify.org)
gcloud sql instances patch homi-db --authorized-networks="$MYIP/32" --quiet
PGSSLMODE=require /opt/homebrew/opt/postgresql@15/bin/psql "host=35.194.65.177 user=postgres dbname=homi_staging"
gcloud sql instances patch homi-db --clear-authorized-networks --quiet
```

## Secret Manager

Console: https://console.cloud.google.com/security/secret-manager?project=homi-testflight

| Secret | Contents |
|---|---|
| `database-url-staging` | Full postgres URL for `app_staging` -> `homi_staging`, unix-socket form `?host=/cloudsql/homi-testflight:us-east4:homi-db` |
| `database-url-prod` | Same for `app_prod` -> `homi_prod` |
| `better-auth-secret` | Generated Better Auth secret |
| `resend-api-key` | Resend API key (send-only scope; domain admin happens in the Resend dashboard, account pranish11khanal11@gmail.com) |
| `redis-url` | Upstash `rediss://` URL (shared staging+prod for now, see Redis section) |
| `sentry-dsn` | Sentry ingest DSN (HOMI-15a; one project shared by API + worker, told apart by the `service` tag). Low-sensitivity write-only key, kept here for rotation and to stay out of the repo. |

`homi-runtime@` has `secretmanager.secretAccessor` on all of them.

Read a secret value from the CLI:

```sh
gcloud secrets versions access latest --secret=database-url-staging
```

## Service accounts

- `github-deployer@homi-testflight.iam.gserviceaccount.com` - used by GitHub Actions via WIF; roles: run.admin, artifactregistry.writer, cloudsql.client, serviceAccountUser on the runtime SA
- `homi-runtime@homi-testflight.iam.gserviceaccount.com` - identity of the Cloud Run services; roles: cloudsql.client, secretmanager.secretAccessor

## Workload Identity Federation

- Pool `github`, provider `github-actions`, locked to `assertion.repository == 'pranish-k/homi-v3'`
- `github-deployer@` bound via `roles/iam.workloadIdentityUser`

## Artifact Registry

- Docker repo `homi` in us-east4: `us-east4-docker.pkg.dev/homi-testflight/homi`
- Console: https://console.cloud.google.com/artifacts?project=homi-testflight

## Redis (provisioned 2026-07-21)

- Upstash free tier, database `usable-burro-43331` at `usable-burro-43331.upstash.io:6379` (TLS)
- URL stored as secret `redis-url` (`rediss://` scheme); `homi-runtime@` has accessor
- Console: https://console.upstash.com
- **Caveat:** one database shared by staging and prod for now (free tier is one db).
  Fine while prod has no traffic; before real prod use, create a second Upstash db so staging rate-limit keys and realtime pub/sub channels cannot bleed into prod, and split into `redis-url-staging`/`redis-url-prod`.

## Email (Resend, HOMI-21)

- Verified sending domain: `contact.homiapp.app` (DNS at Namecheap-hosted nameservers for homiapp.app); sender `HOMI <sign-in@contact.homiapp.app>` via `EMAIL_FROM` in deploy.yml
- Without `EMAIL_FROM`/key the API falls back per env: dev logs links, prod refuses to boot
- Still to add: DMARC TXT record on contact.homiapp.app before outside testers

## Deploy pipeline (HOMI-14)

- `.github/workflows/deploy.yml` (reusable) called by `ci.yml`: main -> staging, `v*` tag -> prod.
- Steps per deploy: WIF auth as `github-deployer@`, docker build+push to Artifact Registry, **migrations via Cloud SQL Auth Proxy before any traffic shifts** (`drizzle-kit migrate` with the env's `database-url-*` secret), then `gcloud run deploy` for API and worker, then a `/healthz` + `/readyz` smoke check.
- Services: `homi-api-staging` / `homi-worker-staging` (main) and `homi-api` / `homi-worker` (tags).
  API is public; worker is IAM-gated (`--no-allow-unauthenticated`) and runs in `WORKER_MODE=http`, where Cloud Scheduler POSTs `/tick` (every minute) and `/prune` (hourly) instead of an in-process poll loop - a poll loop would need always-allocated CPU (~$60/mo).
- Deterministic URLs: `https://<service>-528839783533.us-east4.run.app`.
- GitHub repo variable required: `GCP_WORKLOAD_IDENTITY_PROVIDER` = `projects/528839783533/locations/global/workloadIdentityPools/github/providers/github-actions` (deploy jobs skip silently while unset).
- `github-deployer@` needs `secretmanager.secretAccessor` on `database-url-staging` and `database-url-prod` (for the migration step).

## One-time steps after the first deploy of each env

**Staging: DONE 2026-07-21** - `cloudscheduler` API enabled, `homi-runtime@` has `run.invoker` on `homi-worker-staging`, jobs `homi-worker-staging-tick` (every minute) and `homi-worker-staging-prune` (hourly at :07) created and verified (tick returns 200).
**Prod: still to do after the first tag deploy** - repeat with the `homi-worker` URLs:

```sh
gcloud services enable cloudscheduler.googleapis.com
gcloud run services add-iam-policy-binding homi-worker-staging --region=us-east4 \
  --member="serviceAccount:homi-runtime@homi-testflight.iam.gserviceaccount.com" --role=roles/run.invoker
gcloud scheduler jobs create http homi-worker-staging-tick --location=us-east4 \
  --schedule="* * * * *" --http-method=POST \
  --uri="https://homi-worker-staging-528839783533.us-east4.run.app/tick" \
  --oidc-service-account-email=homi-runtime@homi-testflight.iam.gserviceaccount.com
gcloud scheduler jobs create http homi-worker-staging-prune --location=us-east4 \
  --schedule="7 * * * *" --http-method=POST \
  --uri="https://homi-worker-staging-528839783533.us-east4.run.app/prune" \
  --oidc-service-account-email=homi-runtime@homi-testflight.iam.gserviceaccount.com
```

(Repeat with `homi-worker` URLs for prod after the first tag deploy.)
