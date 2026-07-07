# Sprint 2 (weeks 3-4 of R1)

**Sprint goal:** real authentication and the settlement loop.
A roommate can sign in with a magic link, join a house via an invite link, get a room with a weighted rent share, record a settlement payment, and dispute one inside the 72-hour window.

**Dates:** 2026-07-20 to 2026-07-31.

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-2 | Better Auth: magic-link sign-in, sessions in our Postgres, dev auth shim fully removed (retro action) | 8 |
| HOMI-8 | Invite links: admin creates `homi.app/j/<token>`, hashed at rest, single-tap accept | 5 |
| HOMI-10 | Rooms with weight basis points; room-weighted expense splits derived server-side | 3 |
| HOMI-11 | Record settlement payments (idempotent) with a 72-hour dispute window | 5 |

Committed: 21 points.

## Notes going in

- HOMI-2 lands first; no handler may read auth headers directly, everything flows through one guard (Sprint 1 retro action).
- Social providers (Apple, Google) are config-gated behind env vars; only magic link is exercised until OAuth credentials exist.
- Sending real email needs a transactional email provider; until then magic-link tokens are logged server-side (new backlog story HOMI-21).
- Schema changes follow expand-migrate-contract (H7): legacy `sessions` and `auth_identities` tables stay in place this sprint and are dropped in a later contract migration (HOMI-22).
- The interim add-member endpoint from Sprint 1 is deleted; invites are the only way in.

## Sprint review notes (filled at close)

All four committed stories done; see git history for the increment.
Auth is cookie-session based via Better Auth with sessions and accounts in our Postgres; the dev `x-user-id` shim and `DEV_AUTH_ENABLED` are gone.
Integration tests now authenticate through the real magic-link flow end to end.
Room-weighted splits are derived server-side from room assignments; clients cannot supply their own weights in that mode.
Payment disputes are guarded by state transition in SQL (H2) and the 72-hour window is enforced server-side.

## Retrospective

**Went well:** the single-guard rule from Sprint 1's retro paid off; swapping the shim for Better Auth touched guards and tests but zero handlers.
**Needs improvement:** one shared room cannot yet split its weight across two occupants; rooms currently require exactly one occupant each (refinement filed as HOMI-23).
**Action:** Sprint 3 should start with realtime/snapshot groundwork (HOMI-17, HOMI-20) since the write paths now exist.
