# Sprint 3 (weeks 5-6 of R1)

**Sprint goal:** the app feels alive and reads fast.
A member opens HOME and gets members, balances, action items, and the feed head in one request; when a roommate posts an expense it appears on their screen in under a second via a WebSocket invalidation hint; the full history is browsable as one cursor-paginated ledger; and the unauthenticated auth surface can no longer be used as an email cannon.

**Dates:** 2026-08-03 to 2026-08-14.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-20 | HOME snapshot endpoint: members, balances, action items, feed head in one call | 5 |
| HOMI-17 | Realtime feed over WebSocket, house channels, events as cache-invalidation hints only (H6) | 8 |
| HOMI-16 | Unified cursor-paginated ledger of expenses and payments | 3 |
| HOMI-24 | Rate limiting on auth and invite endpoints (review M6; magic-link send is an unauthenticated email loop) | 3 |

Committed: 19 points.

**Stretch (pull only if the committed set is done):** HOMI-27, DB-verifying `/healthz` (1 point).

## Notes going in

- HOMI-20 lands first, before HOMI-17: realtime events are only invalidation hints (H6), so the snapshot is the thing a hint tells clients to refetch.
  Building the hint before the refetch target would be backwards.
- H6 is the hazard that shapes everything here: events delivered while a phone was offline are gone forever, so the payload of a realtime event is never the data itself.
  On reconnect or foreground, clients refetch the snapshot.
- Per the spec (5.2), the gateway is one channel per house, authenticated at connect, fed by Redis pub/sub so API and workers can both publish.
  Redis enters the local stack for real this sprint; it also backs HOMI-24 rate limiting, which is why the two travel together.
- The connect-time auth check must reuse the existing guard logic (house membership), not reimplement it; the Sprint 1/2 single-guard rule applies to the socket path too.
- HOMI-16's cursor must be stable under concurrent inserts: cursor on (created_at, id), never OFFSET.
- HOMI-24 covers magic-link send and invite accept at minimum.
  Limits are per-IP and per-email, enforced in Redis, and return 429 with Retry-After.
- Local dev quirk stands: no Docker daemon on this Mac.
  Integration tests run against Homebrew postgresql@15 (scratch cluster on 5433); Redis via `brew services` or `redis-server` ad hoc, and CI gets a Redis service container.
- Not this sprint, consciously: HOMI-21 (email provider) waits until there is a deploy target (HOMI-14); magic links stay logged.
  HOMI-13 (recurring bills) stays queued for Sprint 4 with its H4/H5 hazards.
- Process gate from last close: run the independent agent code review before tagging the sprint.

## Sprint review notes (filled at close)

All four committed stories done, plus the HOMI-27 stretch and HOMI-25 as a drive-by; see git history for the increment.
`GET /v1/houses/:id/snapshot` returns house, members, balances, per-caller action items (settle-up debts and open payment confirmations), and the 20-event feed head, all read in one repeatable-read transaction.
`GET /v1/houses/:id/ledger` merges expenses and payments newest-first behind an opaque keyset cursor on (created_at, id); the paginated `created_at` columns were narrowed to timestamptz(3) because a cursor that round-trips through a JavaScript Date (ms) against a microsecond column can skip rows inside the same millisecond.
The WebSocket gateway hangs off the existing HTTP server at `/v1/houses/:id/realtime`; the handshake runs the same session check and the same MembershipService the HTTP guard uses, and hints carry type and ids only, never amounts or descriptions (H6).
Hints publish only after the transaction commits and never on idempotent replays; fan-out is Redis pub/sub when REDIS_URL is set and in-process otherwise, and production refuses to boot with the in-process fallback.
Rate limits (HOMI-24): magic-link sends are budgeted 3 per email and 30 per forwarded IP per 15 minutes inside a Better Auth before-hook; invite create/accept are 20 per user per hour via a Nest guard; both return 429 with Retry-After, Redis-backed when configured.
`getBalances` now reads expenses and payments in one repeatable-read snapshot (HOMI-25), and `/healthz` probes the database with a 2s timeout (HOMI-27).
The integration suite grew from 16 to 26 tests across three files, covering snapshot consistency, cursor walks with no gaps or duplicates, WS handshake rejections (401/403/404), hint delivery and replay silence, and both rate-limit budgets; the suite passes with and without REDIS_URL, and CI now runs it against a Redis service container.

Review gate: the multi-agent cloud review could not run this close (session limits), so an inline high-effort review of the full diff was performed instead; it found and fixed one real bug (the WS path regex accepted 36-character non-UUIDs, turning a 404 into a Postgres cast error 500), one shutdown hazard (the Redis rate limiter captured a client reference that could go stale after closeRedis), plus eviction for the in-memory limiter, an SQL-side dispute-window filter, and four deduplications (shared UUID_RE, shared DISPUTE_WINDOW_MS, shared test signIn helper).

## Retrospective

**Went well:** snapshot-before-realtime ordering meant the hint always had a refetch target to point at, and the MembershipService extraction let the socket handshake reuse the exact HTTP authorization path; the port/adapter split for Redis kept local dev daemon-free while CI exercises the real thing.
**Needs improvement:** realtime publish calls are hand-placed per service method after each transaction; every future mutation must remember to publish, which is exactly the kind of invariant that should live in one mechanism (the activity_events write already inside every transaction is the natural hook).
**Action:** Sprint 4 opens with HOMI-13 (recurring bills) and must start from the hazards: a unique key on (template_id, period) so re-runs never double-post rent (H4), and all scheduling computed server-side in the house timezone (H5); fold the publish-from-activity-events refactor into whichever story next touches the ledger service.
