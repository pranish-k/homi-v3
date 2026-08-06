# HOMI Visual Direction: Calm Ledger

Decided 2026-08-05 (Pranish). Implemented in HOMI-36.

This is the document HOMI-33 (HOME tab), HOMI-34 (add expense) and HOMI-35 (settle up) are built against.
It exists because Sprint 7 closed with visual direction as the single blocker on the critical path, and every remaining Release 1 story is UI work behind it.

Before this, `apps/mobile/src/ui/theme.ts` was an explicitly provisional placeholder: one accent blue, the system font, no components, and two screens that bypassed it entirely with duplicated hex codes.
`HOMI_V3.md` section 4.2 assumed "the v2 design system carries over (colors, spacing, type, Ionicons)", but no v2 tokens exist in this repo, so the system is specified fresh here rather than salvaged.

---

## 1. The direction

**Calm Ledger.**
Typography-led, near-neutral, and quiet.
Colour carries meaning, never decoration.

The one-line test: **if a colour is not carrying meaning, it should not be there.**

Money owed to you is green, money you owe is red, and everything else in the app is greyscale.
There is no brand hue.
The brand is ink, which is why the placeholder `#208AEF` was removed from the app entirely.

The reasoning is the product thesis.
HOMI's job is to be the shared system of record that removes an awkward conversation, and the design test in `docs/PROJECT_OVERVIEW.md` is "does it remove an awkward human conversation or prevent a fight before it starts?"
A ledger earns that by looking like something you can trust and check, not by looking exciting.
It also serves the release gates directly: amounts set large in tabular numerals are what make the show-the-math drilldowns legible, and a restrained surface is what lets "zero balance-math bug reports" be a claim a user can verify at a glance.

Two consequences worth naming, because they are the ones most likely to be argued with later:

- **No shadows, anywhere.** Separation is a hairline border or a surface tint. Elevation is decoration, and decoration is what this direction spends nothing on.
- **The primary button is ink, not a hue.** A filled near-black button in light mode and a filled near-white button in dark mode. If the primary action were blue, blue would compete with green and red for the user's eye, and the money would stop being the loudest thing on the screen.

---

## 2. Palette

Semantic names only.
Screens ask for a colour by meaning and `useTheme()` returns the right one for the active scheme.
Defined in `apps/mobile/src/ui/tokens.ts`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0B0B0C` | screen background |
| `surface` | `#F7F7F8` | `#17171A` | cards, grouped blocks |
| `border` | `#E4E4E7` | `#2A2A2F` | hairline separators, input borders |
| `textPrimary` | `#111113` | `#F5F5F7` | headings, amounts, row labels |
| `textSecondary` | `#6B6B73` | `#A0A0A8` | supporting copy |
| `textTertiary` | `#9A9AA3` | `#6E6E76` | settled state, timestamps, placeholders |
| `ink` | `#111113` | `#F5F5F7` | primary button fill, future active tab tint |
| `onInk` | `#FFFFFF` | `#0B0B0C` | label on an ink fill |
| `positive` | `#0F7A4D` | `#3DD68C` | owed to you |
| `negative` | `#B3261E` | `#FF6B60` | you owe, and errors |
| `link` | `#2563EB` | `#7AA2FF` | text-only secondary actions |

**Direction is never carried by colour alone.**
A balance is green *and* prefixed with an explicit `+`, or red *and* prefixed with `-`, and the surrounding copy names the direction in words ("owes you", "you owe").
Someone who cannot separate the two hues still reads the screen correctly.
`Money` in `src/ui/components/Money.tsx` enforces this: `mode="direction"` always emits the sign with the colour.

`negative` doubles as the error colour.
That is deliberate rather than lazy: an error and a debt are both "something here needs your attention", and adding a third alert hue would break the rule in section 1.

---

## 3. Typography

System font, SF Pro on iOS and Roboto on Android.
No custom font is loaded.
That buys native feel, free Dynamic Type support, and no font-loading gate at startup, and none of those are worth trading for a display face on a screen whose job is to be believable.

| Variant | Size / weight | Line height | Use |
|---|---|---|---|
| `display` | 40 / 700 | 46 | the net position number |
| `title` | 28 / 700 | 34 | screen titles |
| `heading` | 20 / 600 | 26 | section titles, empty-state titles |
| `body` | 16 / 400 | 22 | default copy |
| `bodyStrong` | 16 / 600 | 22 | row values, amounts in a list |
| `label` | 14 / 500 | 20 | buttons, input labels |
| `caption` | 13 / 400 | 18 | timestamps, helper text, errors |
| `overline` | 11 / 600, tracking 0.8, uppercase | 16 | section rules such as ACTIVITY |

Every amount is set in tabular numerals (`fontVariant: ['tabular-nums']`) so a column of them aligns on the decimal point.
`Money` applies this automatically; anything else rendering digits that should stay column-aligned passes `tabular` to `Text`.

**Dynamic Type is on by default.**
`display` and `title` cap at 1.4x and 1.6x so the biggest accessibility sizes cannot push the members list off the HOME screen.
Body-level text is deliberately left uncapped, because that is the text a user with low vision most needs to be able to grow.

---

## 4. Spacing, radius, elevation

Spacing runs on a 4pt base: `xs 4, sm 8, md 12, lg 16, xl 24, xxl 32`.
Every margin, padding, and gap comes from that scale.

Radius: `sm 8, md 12, lg 16, full 999`.
Buttons and inputs use `md`, cards use `lg`.

Elevation: none.
See section 1.

Screen padding is `xl` (24) horizontally plus the safe-area inset, applied once by `Screen`.

---

## 5. Copy rules

Extends Definition of Done item 7, "user-visible copy is direct and non-judgmental (spec 4.2)", into concrete rules.

- State the fact, then offer the fix. "Could not load your house" then "Try again".
- Name the direction in words next to the number. "You owe Sarah $25.00". "Sarah owes you $25.00". "Settled".
- Never "overdue", never "outstanding", never "reminder", never an exclamation mark.
- Never a red badge count on a person. HOMI nags; roommates do not.
- Sentence case everywhere, except the `overline` variant which is uppercase by definition.
- Amounts are always written to two decimal places, never rounded to whole dollars.

The app takes the villain role (spec 4.2), so all nagging comes from HOMI, privately, to the person who can act on it.
That is why `settle_up` action items only ever appear for the debtor.

---

## 6. Component inventory

Everything lives in `apps/mobile/src/ui/`.
No screen writes a hex code, a font size, or a spacing number.

| Component | Responsibility |
|---|---|
| `ThemeProvider` / `useTheme()` | resolves the colour scheme once, app-wide |
| `Screen` | safe-area insets, screen padding, keyboard avoidance, optional scroll and vertical centring |
| `Text` | the whole type scale via `variant`, palette via `tone` |
| `Money` | the only component that renders an amount |
| `Button` | `primary` / `secondary` / `destructive`, owns its own loading spinner |
| `Input` | label, error, and the wide-tracked `code` mode for the OTP field |
| `Card` | a grouped block: surface tint plus hairline |
| `Row` | label-left, value-right list row with an optional hairline |
| `SectionHeader` | the muted uppercase rule above a group |
| `EmptyState` | title, body, and one action |
| `Loading` | the waiting state, with an optional message |

`format.ts` holds `formatMoney`, the single place integer cents become a string.
The API returns integer cents plus a 3-letter currency code and leaves formatting to the client (spec 5), so there is exactly one rounding and one grouping rule in the app.
It uses `Intl.NumberFormat` with the device locale from `expo-localization`, and falls back to a manual formatter if the runtime lacks currency data, because a formatting problem must never hide an amount.

**Icons: Ionicons, via `@expo/vector-icons`.**
Named in `HOMI_V3.md` section 4.2 and confirmed here.
The dependency is deliberately *not* installed yet: the app renders zero icons today, and the first real need is the tab bar in HOMI-33.
That story installs it and adds a thin `Icon` wrapper so the set stays swappable from one file.

---

## 7. HOME screen (HOMI-33)

Data comes from `GET /houses/:houseId/snapshot` in one call, and realtime hints are cache-invalidation only (`packages/domain/src/realtime/hint.ts`), so a hint triggers a full snapshot refetch and never patches state from the socket payload.

Layout, top to bottom:

1. House name, `title`.
2. Action items, if any. Plain text rows above the balance, never coloured alert banners. `settle_up` reads "Pay Sarah $25.00"; `confirm_payment` reads "Sarah says they paid you $25.00" with the `disputableUntil` countdown as `caption`. HOMI asks quietly.
3. The net position: a `body`/`secondary` label ("You are owed" / "You owe" / "You're settled up") above the amount in `display`, coloured by direction with an explicit sign.
4. A hairline rule.
5. One `Row` per member: name left, their balance right as `Money` with `mode="direction"`. A zero balance reads "Settled" in `textTertiary`, not "$0.00", because a settled roommate is a state, not an amount.
6. `SectionHeader` "ACTIVITY", then the feed head.

Feed rows:

- `activity_events` carries `actorId` only and no actor name, so the client resolves it against the snapshot's `members` array. The caller's own events read "You", never their own name.
- The feed can contain event types the v1 UI has no cell for, because bills, rooms, and placeholders are live server-side but hidden from the v1 UI. `bill.created`, `rooms.configured`, `member.placeholder_added` and anything added later must render through a **generic fallback row** rather than being filtered out silently. A user seeing a vague row is recoverable; a user seeing a feed that quietly omits real events is a trust bug in a product whose entire value is being the record.
- Each row is one line of `body` plus a `caption` timestamp. No avatars in v1.

Empty state: a house with no activity yet shows `EmptyState` pointing at the add-expense action, not a blank screen.

---

## 8. Add expense (HOMI-34)

The release gate is a median under 15 seconds, so the layout order *is* the design.

1. **Amount first, keyboard already up, field already focused.** The screen opens ready to receive digits. Nothing above it competes.
2. **Who paid**, defaulting to the current user, since that is the overwhelmingly common case.
3. **Split**, defaulting to equal across all active members. Exact split is one tap away and is the only other mode in v1.
4. **Description**, last and optional. A user who types nothing still gets a valid expense.
5. One primary `Button`.

A user who agrees with every default reaches the button after typing only an amount.
That is the 15 seconds.

Room-weighted splits, bill templates, placeholders, edits, and disputes stay server-side and UI-hidden in v1, per the Epic E6 guardrail.

---

## 9. Settle up (HOMI-35)

One tap records the payment.
Venmo, Zelle and Cash App are deep links offered alongside, not a required step, because HOMI records the truth and does not move the money.
The 72-hour dispute window is stated in `caption` at the point of recording, not hidden in a settings screen.

---

## 10. Navigation

The five-tab structure from `HOMI_V3.md` section 4.1 is `HOME | MONEY | [+] | CHORES | HOUSE`.

v1 ships HOME and the `[+]` create action only.
The tab bar itself arrives with HOMI-33, which also has to convert today's conditional rendering in `src/app/index.tsx` into real routes.
Active tint is `ink`, inactive is `textTertiary`.

One-thumb layout is a standing constraint: every core action stays reachable from the tab bar.

---

## 11. Open: brand assets

`apps/mobile/assets/images/` still holds the stock Expo template art.
HOMI-36 fixed the *configuration* around it, since the splash background was hardcoded to the placeholder blue that this direction removes:

- splash background is now `#FFFFFF` light and `#0B0B0C` dark, so dark mode no longer flashes blue
- the Android adaptive icon background moved off the Expo default `#E6F4FE`, which had never matched the splash
- `imageWidth` moved from 76 to 160, having been sized for the non-square 228x213 template image

**The artwork itself is still owed, and is a prerequisite for the first TestFlight build that goes to testers outside the team.**
What it needs to be:

- App icon: the HOMI wordmark in `onInk` on an `ink` field. No gradient, no glyph, no drop shadow. 1024x1024, and the current `icon.png` is an unoptimized 799 KB that should be replaced rather than compressed.
- Splash: the same wordmark, centred, on `bg` in light and on `bg` dark. Square source art so `imageWidth` means what it says.
- Android adaptive icon: the wordmark on the ink field, with the monochrome variant supplied.
