# Sprint 7 (first TestFlight sprint)

**Sprint goal:** HOMI gets onto a phone.
By sprint end an Expo app installs from the TestFlight internal track, signs in with a magic link against the deployed staging API, and lands the user in a house they created or joined.
This is the first client sprint of epic E6 (TestFlight v1, decided 2026-07-19): the expense loop only, everything else the backend supports stays hidden until a later build surfaces it.

**Dates:** started 2026-07-21, closed 2026-07-25.
**Outcome:** 13 of 13 committed points delivered; stretch HOMI-33 not pulled; sprint goal partly met (see review notes).

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-30 | Expo app scaffold builds via EAS and installs from the TestFlight internal track | 5 |
| HOMI-31 | Magic-link sign-in from the phone with a persistent cookie session against the deployed API | 5 |
| HOMI-32 | Create a house or join one by tapping an invite link | 3 |

Committed: 13 points, matching Sprint 6's committed size.

**Stretch (pull only if the committed set is done):** HOMI-33, the HOME tab showing balances, members, and the feed head from the snapshot endpoint (5 points).

## Notes going in

- Decisions confirmed 2026-07-21 (Pranish): bundle id is `app.homiapp.mobile`; the client lives at `apps/mobile` as Expo React Native (TypeScript) with expo-router; dev builds target the deployed staging API by default (https://homi-api-staging-528839783533.us-east4.run.app), overridable via `EXPO_PUBLIC_API_URL` - no local-only prototypes (the demo/web lesson).
- HOMI-30 splits into two halves.
  Half A is agent-doable: the `apps/mobile` workspace scaffold, TypeScript strict, expo-router, a boot screen that proves connectivity by calling staging `/readyz`, and lint/typecheck wired into the root scripts and the CI quality job.
  Half B needs Pranish at the keyboard: EAS project creation, Apple Developer signing, and the TestFlight internal track upload (Apple and Expo account logins).
- Expo needs its own `tsconfig` (jsx plus bundler module resolution); it cannot extend the commonjs `tsconfig.base.json` wholesale, so `apps/mobile` carries a self-contained config while keeping strictness aligned.
- v1 scope guardrail stands: bills, rooms, placeholders, edits, and disputes stay server-side and UI-hidden; each is a later build's headline feature.
- UI direction: committed stories ship with placeholder styling (minimal, system font, iOS light/dark, one accent color); Pranish gives visual direction before the HOME tab and add-expense work (HOMI-33/34), which are the face of the app and the under-15-seconds release gate.
- Not this sprint, consciously: DMARC on contact.homiapp.app (internal-track testing is own-inbox, so not blocking; required before outside testers), the Upstash staging/prod Redis split (before real prod traffic), Dockerfile nested-node_modules band-aid (needs a Docker-capable env), HOMI-15 dashboards, HOMI-18/19 nudges and digest.
- Standing process: trunk-based short-lived branches and PRs merged on green CI, independent code review before tagging the sprint close, prod deploys tag-triggered.

## Progress log

**2026-07-21, HOMI-30 Half A done (merged to main):** `apps/mobile` scaffold - Expo SDK 57 + expo-router as npm workspace `@homi/mobile`, TypeScript strict with a self-contained tsconfig, bundle id `app.homiapp.mobile`, boot screen proving the phone-to-staging path via `/readyz` (verified in the iOS simulator: "API ready" against the live staging URL).
Typecheck joins the root workspaces script (and thus the CI quality job); root eslint covers the TSX files (verified the TS parser applies).
Dockerfile confirmed unaffected: `npm ci` without `apps/mobile` present resolves backend-only (verified by simulating the Docker build context locally), so backend images stay lean with no workflow changes.

**2026-07-22, HOMI-30 Half B done - HOMI is on TestFlight:** EAS project `@pkhanal/homi` created and linked; `eas.json` `internal` profile (remote versions, auto-increment).
Apple side required two account chores first: accepting the updated Developer Program License Agreement and the EU DSA trader status declaration - both blocked bundle-id registration with a misleading "failed to register" error.
Cloud build succeeded (buildNumber 3 after two agreement-blocked attempts), `eas submit` created the App Store Connect app (ASC App ID 6793742099; name "HOMI (63cdfc)" because "HOMI" was taken - display name on device is still HOMI; rename in ASC later), uploaded the binary, created the internal TestFlight group "Team (Expo)", and enabled access for the account holder.
An App Store Connect API key was generated and stored on EAS servers, so future builds and submissions run non-interactively.
Interactive EAS/Apple steps must run in a real terminal, not the agent session shell (EAS falls back to non-interactive mode without a TTY).
`ITSAppUsesNonExemptEncryption=false` set in app.json (HTTPS-only, exempt) so builds skip the manual export-compliance question.

**2026-07-22, HOMI-31 built (branch `homi31-magic-link`, E2E-verified in the simulator):** magic-link sign-in on the phone with a persistent cookie session.
Design: the emailed link points at a new API interstitial (`GET /auth/link?token=`) that bounces into the app via the `homi://auth/verify` deep link; the app then calls the verify endpoint itself (Better Auth `magicLink.verify`), so the session cookie is set on the app's own request and stored in SecureStore - emailing the raw verify URL would have signed in Safari instead of the app.
API: `@better-auth/expo` server plugin + `trustedOrigins` for `homi://` (and `exp://` outside production); dev/test `lastMagicLink` still captures the raw verify URL, so the existing test helper is untouched; new `auth-mobile.integration.test.ts` covers the interstitial (token validation, no server-verify link on the page) and the app-style verify flow including token single-use.
Mobile: Better Auth client (`magicLinkClient` + `expoClient` with SecureStore) at `src/auth/client.ts`, session-gated index (sign-in screen / signed-in placeholder), `src/app/auth/verify.tsx` deep-link route.
Verified E2E in the iOS simulator against a local API: sign-in form -> logged link -> deep link -> "Signed in as ..."; session survives app kill+relaunch; replaying a consumed token shows the error screen.
Gotchas hit: `@better-auth/expo` needs `expo-network` at cold start with a cached session (crashes without it - only caught by the relaunch test); npm produced an invalid dedupe giving better-auth zod@3 (runtime `z.coerce.boolean(...).meta is not a function`), fixed by pinning better-auth + @better-auth/expo to exactly 1.6.23 in both workspaces; expoClient's types don't satisfy `BetterAuthClientPlugin` under TS 6, needing a narrow structural cast in `client.ts`.
Dev-mode reminder: without `RESEND_API_KEY` the API logs the magic link instead of emailing it; real emails require the staging/prod deploy.

**2026-07-22, HOMI-31 extended (same branch) with an email-OTP code path:** Pranish was wary the emailed link might not open the app, so a deep-link-free fallback was added alongside the link.
Better Auth's `emailOTP` server plugin and `emailOTPClient` are already in the pinned 1.6.23 (no dependency change, so no zod dedupe trap; no migration - codes live in the existing `verification` table; no hand-written routes - the plugin auto-mounts `/api/auth/email-otp/send-verification-otp` and `/api/auth/sign-in/email-otp`).
The magic-link rate limit was renamed `signInEmailRateLimit` and now covers both send channels under one shared budget; `signIn.emailOtp` accepts an optional `name` so first-signup naming works on either channel.
Mobile SignInScreen now leads with "Email me a code" (primary) and "or send me a link instead" (secondary), with a new code-entry phase; new `auth-otp.integration.test.ts` (3 tests).

**2026-07-24, HOMI-31 DONE - merged and verified on staging:** PR #24 (`homi31-magic-link` -> `main`) merged on green CI (`main` @ `c0afdd6`); it supersedes the earlier PR #23, which was closed unmerged after conflict churn.
The merge auto-deployed staging (`homi-api-staging` revision 00013-699, migrations applied, `/readyz` 200).
Real-email OTP flow verified end to end against live staging: `send-verification-otp` delivered a real Resend email, and `POST /api/auth/sign-in/email-otp` with the emailed code returned 200 with a session token.
Note: the `name` param only applies at first signup, so pre-existing accounts keep their stored name.
Still unverified on a real device: the magic-link `homi://` deep link (needs an EAS build to exercise) - deferred with the TestFlight build below.

**2026-07-24, decision - first TestFlight build deferred:** Pranish chose not to cut an EAS/TestFlight build for sign-in alone; the first build waits until the app can create/join a house and split a cost, matching E6's own "expense loop only" definition of TestFlight v1.
So HOMI-31 stays staging-verified only; no EAS build this step.

**2026-07-25, HOMI-32 DONE - create a house or join by invite link:** PR #26 merged on green CI (`main` @ `e5b08ab`), staging auto-deployed and verified live.
Three API additions: `GET /v1/houses` (live memberships - the client had no way to learn which house it was in), `GET /v1/invites/:token` (preview the house, inviter, and any bound placeholder without consuming a use), and `GET /j/:token`, the interstitial that `invites.service` had been minting URLs for since HOMI-8 with nothing serving that path.
The HOMI-31 magic-link page moved onto a shared `lib/deep-link-page` renderer that both interstitials now use, and `INVITE_LINK_ORIGIN` falls back to `BETTER_AUTH_URL` instead of `https://homi.app`, which would have handed out links nothing answers.
Mobile: an `apiFetch` that attaches the SecureStore cookie by hand (React Native shares no cookie jar with the auth client), a house gate that refetches on focus so the join deep link lands home with the new membership showing, a create-house form taking only the name, admin-only invite creation through the OS share sheet, and a `homi://join` route where accepting is an explicit tap.
That last point is a deliberate safety choice: an invite link travels through group chats and can be opened by someone it was not meant for, and a bound invite additionally claims a placeholder's ledger history, so the house, inviter, and any "join as Sam" are named before the join button.
Verified with 7 new integration tests (81 API tests green), then curl-verified end to end against a local API, then against live staging after merge: real OTP sign-in, `GET /v1/houses` empty then listing the created house as admin, an invite minted at the staging origin so `/j/` self-resolves, that URL serving the interstitial, and preview returning the house and inviter.

**2026-07-25, new blocker - local iOS builds broken by Xcode 26:** `npx expo run:ios` fails with 15 Swift errors inside `node_modules/expo-modules-jsi`, which declares `weak let runtime`; Swift 6.2 (Xcode 26.0.1) rejects it as "'weak' must be a mutable variable".
`expo-modules-jsi@57.0.4`, one patch above the installed version, carries the same code, so a patch bump is not the fix.
This is an upstream Expo/Xcode incompatibility, not project code, and it appeared after HOMI-31 verified cleanly in the simulator on 2026-07-22.
EAS cloud builds are unaffected because they use Expo's own Xcode, so TestFlight stays available; what is lost is fast local simulator verification, which is why HOMI-32 was verified by curl against real APIs instead.

## Next steps

- **HOMI-33 (HOME tab) and HOMI-34 (add expense) need Pranish's visual direction first** - they are the face of the app and the under-15-seconds release gate, so the expense UI should not be built on placeholder styling.
  This is now the single blocker on the critical path: every remaining E6 story is UI work behind this decision.
- **First TestFlight build** comes after the expense loop is wired (HOMI-33 -> 34, and ideally HOMI-35 settle up): `cd apps/mobile && npx eas-cli build --platform ios --profile internal --auto-submit` (run in a real terminal; ASC API key already on EAS, so submit is non-interactive).
  That build is also the first exercise of both deep links, `homi://auth/verify` and `homi://join`, neither of which any device has run.
- **Pre-tag code review** over `v0.6.0-sprint6..HEAD` is owed before the sprint tag, per the standing process and DoD item 1.

## Sprint review notes (filled at close)

**2026-07-25, close.** All 13 committed points delivered: HOMI-30, HOMI-31, and HOMI-32 are done, merged, and green.
The stretch story HOMI-33 was not pulled, correctly: it is blocked on visual direction, not on capacity.

**The sprint goal is only partly met, and the gap is worth stating plainly.**
The goal was "an Expo app installs from the TestFlight internal track, signs in with a magic link against the deployed staging API, and lands the user in a house they created or joined."
HOMI is on TestFlight, but the binary sitting there is HOMI-30's scaffold.
Sign-in and house create/join are both real and verified against live staging, and neither has ever run on a phone.
That is a consequence of a deliberate call on 2026-07-24 - not shipping testers a sign-in screen with nothing behind it - which was the right product decision and still leaves the goal's end-to-end sentence untrue at close.

What is verified, and how:
- HOMI-30: the app installed from TestFlight on a real device (internal group "Team (Expo)").
- HOMI-31: real-email OTP sign-in end to end against live staging, returning a session token.
- HOMI-32: create, invite, preview, and join verified by curl against live staging after merge; the accept half of the second-user path was exercised locally and by integration tests rather than on staging, to avoid burning a second real inbox.
- Test suites at close: 34 unit, 81 API integration, plus the worker suite, all green.

What remains unverified, and why it matters:
- Both deep links, `homi://auth/verify` and `homi://join`, have never run on a device.
  They are the two places where the phone hands control back to the app, and they are exactly the kind of thing that works in every test and fails on the handset.
  The next EAS build is the first honest test of either.
- The Xcode 26 breakage removed the cheap way to catch that class of bug mid-story.

Carried debt, unchanged from Sprint 6: DMARC on contact.homiapp.app, the Upstash staging/prod Redis split, and the Dockerfile nested-`node_modules` band-aid.
New debt: a throwaway house on staging owned by a plus-aliased test account, and the Expo/Xcode incompatibility, which is upstream and can only be waited out.

## Retrospective

**Staging-first kept paying.** The Sprint 7 rule of no local-only prototypes meant that within minutes of each merge there was a real deployed API to point at, and that is what saved HOMI-32 when the simulator route disappeared.
A curl walk through sign-in, create, invite, interstitial, preview, and join is not as good as tapping through the app, but it is a genuine end-to-end proof, and it existed only because the API was already deployed and reachable.

**Two of the three hardest problems this sprint were toolchain, not code.**
The better-auth zod dedupe in HOMI-31 and the Xcode 26 Swift change in HOMI-32 both cost real time, both were invisible until something actually built or booted, and neither had anything to do with the story being written.
The mitigation that worked was pinning exact versions and then verifying the pin survived every subsequent install; the mitigation that did not exist was any signal that the host toolchain had moved under us.

**Scoping a sprint goal around an artifact we might choose not to cut was a planning error.**
"Installs from TestFlight" reads as a deliverable but is really a release decision, and when the right call turned out to be "not yet", the goal became unmeetable through no fault of the work.
A goal phrased around capability - "sign-in and house membership work against the deployed API" - would have been fully met and would have described the same sprint.
Worth applying to Sprint 8: state the goal in terms of what the software can do, and treat shipping to testers as a separate, explicit decision.

**The visual-direction gate was predicted on day one and still became the blocker.**
The Sprint 7 notes said Pranish owes visual direction before HOMI-33/34.
That was correct and it was never resolved during the sprint, so the sprint ends with every remaining E6 story queued behind one decision.
A dependency named at planning time is not managed just by being named.
