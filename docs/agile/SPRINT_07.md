# Sprint 7 (first TestFlight sprint)

**Sprint goal:** HOMI gets onto a phone.
By sprint end an Expo app installs from the TestFlight internal track, signs in with a magic link against the deployed staging API, and lands the user in a house they created or joined.
This is the first client sprint of epic E6 (TestFlight v1, decided 2026-07-19): the expense loop only, everything else the backend supports stays hidden until a later build surfaces it.

**Dates:** started 2026-07-21.

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

## Sprint review notes (filled at close)

## Retrospective
