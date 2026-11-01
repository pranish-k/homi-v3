# Sprint 8 (the expense loop)

**Sprint goal:** a roommate can see what they owe, add an expense, and settle up, from the phone against the deployed API.
By sprint end the three screens that make HOMI a product rather than a backend are real: HOME shows balances and activity, adding an expense takes under 15 seconds, and settling up records a payment in one tap.

The goal is deliberately phrased as capability, not as "ships to TestFlight".
Sprint 7's goal was scoped around cutting a build, and when the right call turned out to be "not yet", the goal became unmeetable through no fault of the work.
Cutting the TestFlight build is a separate, explicit decision this sprint, recorded below.

**Dates:** started 2026-08-07.
**Outcome:** _(filled at close)_

## Committed stories

| ID | Story | Points |
|---|---|---|
| HOMI-33 | The HOME tab shows balances, members, and the feed head from the snapshot endpoint, refreshed by realtime hints | 5 |
| HOMI-34 | Add an expense (equal or exact split) in under 15 seconds, which is the R1 release gate | 5 |
| HOMI-35 | Settle up: record a payment in one tap, with Venmo, Zelle, and Cash App deep links | 3 |

Committed: 13 points, matching Sprint 6 and Sprint 7.

**Stretch (pull only if the committed set is done):** HOMI-18, private stale-debt nudges to debtors (3 points).
It is the first thing that makes HOMI act on its own behalf, and it needs the expense loop to exist before it has anything to nudge about.

## Notes going in

- **All three stories are client-only.** Every endpoint they need already exists and is deployed: `GET /v1/houses/:houseId/snapshot` (HOMI-20), `POST /v1/houses/:houseId/expenses` and `POST /v1/houses/:houseId/payments` (HOMI-4 and HOMI-10). No migration and no new endpoint is expected. If one turns out to be needed, that is a signal the story drifted, and it should be questioned rather than absorbed.
- **Money mutations require an `Idempotency-Key` UUID header**, enforced by the `@IdempotencyKey()` decorator, and the mobile `apiFetch` does not send one today. HOMI-34 has to add it, and the key must be generated once per user submit and **reused across retries** - a fresh key per retry is a double-post, which is exactly the bug idempotency exists to prevent. This is the first thing to build in HOMI-34, not an afterthought.
- **Open decision, needed before HOMI-34: `description` is required server-side** (`z.string().min(1).max(200)`), but the design direction puts description last and optional so a user who types only an amount still gets a valid expense. Two options: relax the schema to optional with a server-side default, or have the client send a sensible default. Recommendation: **client-side default**, because an expense with no description is a client affordance, not a data model change, and the ledger stays strict. Decide at HOMI-34 start.
- **The tab bar arrives with HOMI-33.** Today's navigation is conditional rendering inside `src/app/index.tsx`, and it has to become real routes under a `(tabs)` group. v1 surfaces HOME and the `[+]` create action only; MONEY, CHORES, and HOUSE are in the spec's five-tab map but are not built this sprint. `@expo/vector-icons` (Ionicons) is installed here, per `docs/design/DESIGN_DIRECTION.md` section 6, and lands with a thin `Icon` wrapper.
- **Realtime is at `ws://.../v1/houses/:houseId/realtime`**, authenticated by the session cookie at the handshake. Two things to watch: React Native's WebSocket takes headers differently from the browser API, so attaching the cookie is the risky part; and hints are **cache-invalidation only**, carrying ids and never data, so a hint must trigger a full snapshot refetch and must never patch state from the payload.
- **The feed needs two things that are easy to get wrong**, both specified in the design doc section 7: `activity_events` carries `actorId` and no actor name, so rows resolve against the snapshot's `members` array; and the feed can contain event types v1 has no cell for (`bill.created`, `rooms.configured`, `member.placeholder_added`), which must render through a generic fallback row rather than being filtered out silently.
- **Design is decided, so it is not a discussion this sprint.** Calm Ledger, in `docs/design/DESIGN_DIRECTION.md`, with the HOME and add-expense layouts already specified. Build against it. If something in the doc turns out to be wrong once real data is on screen, change the doc in the same PR rather than diverging from it quietly.
- **Carried from HOMI-36, and owed early:** the design system has never been seen in dark mode or on a device. Do that pass at the start of HOMI-33, not at the end of the sprint, so any correction lands before three screens are built on top of it.
- **Local iOS builds are still blocked** by the Xcode 26 / expo-modules-jsi incompatibility (upstream, unfixed). Verification leans on curl against the deployed API plus `npx expo export --platform web` for render checks, with Expo Go as the device route. See the workaround notes in the Sprint 7 log.
- **v1 scope guardrail stands:** bills, rooms, placeholders, edits, and disputes stay server-side and UI-hidden. `mode` accepts `percent` and `room_weighted`; the v1 UI offers `equal` and `exact` only.
- **The TestFlight build is a separate decision, taken when the loop works**, not a goal component. When taken: `cd apps/mobile && npx eas-cli build --platform ios --profile internal --auto-submit`, run in a real terminal. It is also the first device exercise of both deep links, `homi://auth/verify` and `homi://join`, neither of which any device has ever run. Real icon and splash artwork is a prerequisite before any tester outside the team.
- **Not this sprint, consciously:** DMARC on contact.homiapp.app (required before outside testers), the Upstash staging/prod Redis split, the Dockerfile nested-`node_modules` band-aid, HOMI-15 dashboards, HOMI-19 weekly digest.
- **Standing process:** trunk-based short-lived branches and PRs merged on green CI, pre-tag code review before the sprint tag, prod deploys tag-triggered.

## Progress log

**2026-08-08, HOMI-33 done - the HOME tab (PR #31, merged `2ac7d1b`):** navigation became real routes.
`src/app/(tabs)/` now holds `_layout.tsx` (resolves the house once and hands it to every tab through `src/houses/HouseContext.tsx`), `home.tsx`, and `house.tsx`; `/` stays the gate, with `HouseGate` redirecting to `/home`.
There is deliberately no `(tabs)/index.tsx`, because it collides with `app/index.tsx` at `/`.
HOME renders action items first as plain rows, then the net position, then per-member balances, then the feed head, per `docs/design/DESIGN_DIRECTION.md` section 7.
New files: `src/home/HomeScreen.tsx`, `src/houses/snapshot.ts`, `src/houses/feed-copy.ts`, `src/houses/useRealtimeHints.ts`, `src/houses/HouseContext.tsx`, `src/ui/components/Icon.tsx`.
Ionicons was installed here, as the design doc planned, and the better-auth 1.6.23 pin plus its nested zod survived the install.

**Bug made and caught during HOMI-33, worth remembering:** per-member rows must be read from `balances.pairwise`, never `balances.net`.
A member's `net` is their standing against the whole house and says nothing about what passes between them and the viewer; only `pairwise` can say "Sarah owes you $25.00".
The first implementation used `net` and would have shipped confident, wrong numbers.

**2026-08-08, the design system's dark-mode debt (carried from HOMI-36) is paid:** Chrome's `--force-prefers-color-scheme` is ignored in headless, but the DevTools Protocol `Emulation.setEmulatedMedia` works.
Recipe: `expo export --platform web`, serve it, launch Chrome with `--remote-debugging-port`, drive CDP over Node's global `WebSocket`, and poll for real rendered text before screenshotting - the static export prerenders in light, so a fixed delay captures pre-hydration HTML and misreports the theme.

**2026-08-11, HOMI-34 done - add an expense (PR #32, merged `942eefa`):** amount-first layout, payer defaulting to you, equal split by default with an exact mode, description last and optional.
The `description` decision went the recommended way: the client sends a default of "Expense" rather than relaxing the server schema, so the ledger stays strict.
`apiPost` now takes an optional idempotency key and sets the `Idempotency-Key` header; the screen generates the key once per submit, holds it in a ref across retries, and clears it only on success, so a failed attempt retried is the same operation and a double tap cannot post twice.
Amounts parse digit-wise into integer cents rather than multiplying a float, because `19.99 * 100` is `1998.9999999999998`.

**2026-08-16, the app finally ran natively, and it found three real bugs.** Local iOS builds are still blocked by Xcode 26, but an EAS *simulator* build is not: build with the new `development-simulator` profile, download the `.tar.gz`, `xcrun simctl install`, run `npx expo start --dev-client`, and `xcrun simctl launch`.
Three defects were visible only on the real runtime and are now fixed: a disabled filled button at 0.4 opacity was the brightest element on the dark-mode screen; "$0.00" printed underneath "You're settled up", restating a state as an amount; and an uncapped body label outgrew the capped display amount at the largest Dynamic Type size, inverting the hierarchy.
Every one of these was invisible in the web export.

**2026-08-17, HOMI-35 built - settle up (PR #33, CI green, not yet merged):** `src/settle/SettleUpScreen.tsx` and `src/settle/api.ts`, reached from HOME's `settle_up` action row rather than from the tab bar, so the debtor never goes looking for it.
The amount is pre-filled from what HOME says you owe and stays editable for a part payment; method chips (Venmo, Cash App, Zelle, cash, other) open the payment app through `Linking.canOpenURL` but are never required, because HOMI records the truth and does not move money.
The idempotency key is held across retries as in HOMI-34, and the copy names the 72-hour dispute window.

## Next steps

**The verification gap, and the one thing that closes it.** None of the money rendering has been seen with real numbers.
The test house has a single member, and a solo house is always settled, so `balances.pairwise`, the red/green direction, the explicit `+`/`-` signs, the per-member rows, and the settle-up action item have never drawn a live figure on screen.
The unblock is one second account: create an invite, sign out, sign in as a plus-alias address, tap the invite.
The existing $44 grocery expense then splits, and the second account should read "You owe Pranish $22.00" in red, with a member row and a settle-up item that opens the new screen.

Also untested by anyone: double-tap idempotency on add-expense against the live API, the `19.99` float-rounding path end to end, and odd-cent splits where the remainder has to land somewhere.

Then: merge PR #33, decide on the stretch story HOMI-18, and close the sprint.
Still owed from earlier and not this sprint's work: real app icon and splash artwork (a prerequisite before any tester outside the team), `homi://auth/verify` and `homi://join` on real hardware, and the first TestFlight build of the whole loop, which stays a separate explicit decision.

## Sprint review notes (filled at close)

_(filled at close)_

## Retrospective

_(filled at close)_
