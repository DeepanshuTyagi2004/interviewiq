# Signed-in app HUD redesign: cards, radius, search and 90% density

**Date:** 2026-10-02 · **Status:** approved in chat, pending spec review · **Area:** `apps/web` (signed-in app + admin)

## Intent

- Card content across the signed-in app looks flat and generic. Make it look futuristic, in a **mission-control HUD** style, using only the existing InterviewIQ tokens: warm-neutral paper palette, ink, the `brand` orange as the only accent, Geist + Geist Mono, light and dark.
- ~~Radius drift: replace with one strict scale.~~ Dropped. See decision 3: the current rounder corners stay as they are.
- **Navbar search.** Redesign the top-bar ⌘K field and the command palette in the same HUD style.
- **Density.** Render the whole signed-in app (and admin) at **90% magnification** by default.

**Decisions made (user, 2026-10-02):**

1. Reference = **mission-control HUD**: corner-tick brackets, mono readout labels, a faint grid backdrop, segmented meters, status dots and a hover spotlight.
2. Intensity = **balanced**. It works in both themes, and orange stays the only accent.
3. ~~Corners = tight scale + chamfer.~~ **Superseded (user, 2026-10-02, during implementation):** another session had already re-cornered the app to a rounder scale (base `--radius` 10px, cards/panels `14px`, dialogs + ⌘K `16px`, shell `18px`, top-bar controls `10px`). The user chose to **keep those rounder corners**, so there is no radius unification. The HUD primitives use the same sizes (cards `rounded-[14px]`). The 45° notch stays as a decoration, enlarged to an **18px** cut so it replaces a 14px rounded corner cleanly. Hero/stat cards and the ⌘K palette only.
4. Scope = **signed-in app + admin**, i.e. every `(app)` section, the top bar + ⌘K, and `(admin)`. Marketing, auth and onboarding keep their current look.
5. Approach = **scoped HUD layer → primitives → section sweep** (not a CSS override layer, not per-section bespoke rewrites).
6. 90% = **CSS `zoom: 0.9` on `<html>` while in scope**, not a hand re-scale of every px value.

## Out of scope

- Marketing, auth and onboarding visuals (they must not shift).
- Any new data, scores, readiness levels or level names. Empty states stay honest (`—`, "coming soon").
- Building the stub screens (loops, practice, leaderboard, settings, admin pages). They get only the shared placeholder frame.
- New runtime dependencies. Everything is CSS + existing React/Tailwind/lucide.
- Copy changes, except mono readout labels that restate existing facts.

## Honesty guard (applies everywhere)

The HUD never invents telemetry:

- A **live/pulsing** status dot appears only when something really is live or running: a live session, prep in progress, a syncing source, a running ingestion. A round that is ready to join is a steady (non-pulsing) brand dot, the same on the dashboard and the interviews list. Everything else uses the idle grey dot.
- No fake tickers, no count-up animations, no sample numbers. Score and rank slots stay `—` with their "coming soon" notes.
- Readout labels only restate data the screen already shows (`DEPTH 2/5`, `02/04 SOURCES LINKED`, `SLOT / LEVEL / TRACK`).
- Readiness copy rules are unchanged: no badges, nothing that implies company endorsement, edited loops don't count.

---

## 1. Scope mechanism

- New client hook `useHudScope()` (in `components/hud/`). On mount it adds class `iq-hud` to `document.documentElement` and removes it on unmount. It is called once in `components/layout/app-shell/AppShell.tsx` and once in the `(admin)` layout.
- Putting the class on `<html>` means Radix portals (dialogs, popovers, dropdowns, tooltips, sheets, ⌘K) inherit the HUD tokens and the zoom, because they render under `<body>`.
- Marketing, auth and onboarding never mount the hook, so they never get the class. Their radii, zoom and decorations stay unchanged.
- First paint: `RequireAuth` shows its spinner before the shell mounts, so the class is in place before any card renders. No flash of the un-HUD look.

## 2. Tokens (`app/globals.css`, `tailwind.config.js`)

> **Superseded by decision 3.** The radius table, the radius sweep and the `rounded-shell` token below are **not implemented**; corners stay as the working tree has them. Still in force from this section: the `hud:` variant (used to gate HUD-only elements in shared components), the HUD variables, and the zoom.

**Radius.** Inside `.iq-hud`:

| Token | Value | Used for |
| --- | --- | --- |
| `--radius` (shadcn `lg`) | 6px | cards, panels, popovers, dialogs |
| shadcn `md` (`--radius − 2px`) | 4px | buttons, inputs, search field, selects, segmented controls, tiles |
| shadcn `sm` (`--radius − 4px`) | 2px | pills, tags, kbd, small chips |
| new `rounded-shell` (`--radius-shell`) | 8px | the page card in the shell, the ⌘K palette |
| `rounded-full` | — | avatars and status dots **only** |

- Outside the scope the shadcn values are unchanged (`--radius` stays 7px), and `--radius-shell` defaults to the current shell radius, so public pages don't move.
- Every arbitrary radius (`rounded-[Npx]`, `rounded-xl`, bare `rounded`, side variants) inside `app/(app)`, `app/(admin)`, `components/layout/app-shell`, `components/observability`, `components/patterns`, `components/visualizations` and `components/ui` is replaced with `rounded-lg`, `rounded-md`, `rounded-sm`, `rounded-shell` or `rounded-full`, per the table above. Components that also render outside the scope follow the shared-component rule below instead.
- Any remaining `rounded-full` that isn't an avatar or a dot becomes `rounded-md`. That covers the theme toggle's pill track, which becomes a 4px segmented control.
- **`hud:` variant.** A Tailwind variant, `addVariant("hud", ".iq-hud &")`, added as an inline plugin in `tailwind.config.js` (part of `tailwindcss`, no new dependency).
- **Shared components keep their public look.** Some components also render outside the scope:
  - the `ConnectionsGrid` tree, which onboarding's Sources step uses: `SourceList`, `SourceRow`/`SourceTile`, `LeetCodeRow`, `ResumeRow`, `ProviderRow`, `ConnectionButton`, `DisconnectDialog`;
  - `ThemeToggle`, used in the onboarding, auth and marketing layouts;
  - `MonoPill`/`.iq-pill`, used in onboarding and marketing.

  These keep their current arbitrary radius and add the token through the variant (e.g. `rounded-[10px] hud:rounded-lg`, `rounded-full hud:rounded-md`). `.iq-pill` gets an `.iq-hud .iq-pill` rule. HUD-only elements inside them (e.g. `SourceRow`'s `StatusDot`) are `hidden hud:inline-flex`. Result: onboarding, auth and marketing render pixel-identical to today.
- shadcn primitives that already use `rounded-md`/`rounded-sm`/`rounded-lg` (`button`, `input`, `sheet`, …) need no change. Their values follow the scoped `--radius`, so they're unchanged outside the scope.

**HUD variables.** Inside `.iq-hud`:

- `--hud-zoom: 0.9`.
- `--hud-tick`: the corner-tick colour (`line-4`). It switches to `brand` on hover, focus and active.
- `--hud-grid`: the dot colour of the grid backdrop (`line-2` at low alpha).
- `--hud-glow`: the spotlight colour. Light theme uses `foreground` at ~4% alpha, dark uses ~6%.
- Light and dark each get a value; no new hues.

**Zoom.** `.iq-hud { zoom: var(--hud-zoom); }`. Viewport units are zoomed too, so the shell's `h-dvh` becomes `h-[calc(100dvh/var(--hud-zoom,1))]` to fill the window with no bottom gap. The same compensation goes on `LiveIngestionPanel`'s `100vh` cap and any other viewport-height values in scope.

## 3. HUD primitives (`components/hud/`, exported from `components/hud/index.ts`)

| Primitive | What it is | Notes |
| --- | --- | --- |
| `HudCard` | The one bordered card frame: hairline `border-line-2`, `rounded-lg`, `bg-card`. Props: `title`, `meta`, `action`, `footer`, `notch`, `tone` (`default` / `inverse` for the dark Up-next card), `as`, `aria-label`, `className`, `bodyClassName`. | Header row: mono uppercase title ── leader line ── `meta` / `action`. Corner ticks + hover spotlight render only under `.iq-hud`. `footer` = mono readout strip. |
| `HudEmpty` | Empty body: a mono `NO DATA` tag (or a custom `tag`) + the existing title/hint copy + optional children. | Replaces `ListEmpty`, `CardEmpty` (both copies) and the inline empty blocks. |
| `Readout` | A label/value pair: mono uppercase label, tabular value, optional unit and note. Sizes `sm` / `lg`. | Score tiles, identity score slots, live-check rows, aside counts. |
| `SegmentMeter` | N segments with `filled` count. Props: `segments`, `filled`, `tone` (`ink` / `brand`), `size`, optional readout `label` (`DEPTH 2/5`). | Replaces `DepthMeter`'s bars, both readiness meters, the source-count meter. `filled` is clamped to `0…segments`. |
| `StatusDot` | A dot plus an optional mono label. States: `live` (brand, pulse), `active` (brand, steady), `idle` (faint), `warn`, `error` (destructive). | Pulse only under `motion-safe`. Pulse only for `live`. |
| `GridBackdrop` | A utility class `hud-grid`: radial-gradient dot grid in `--hud-grid`, with a mask fade at the edges. | Used on `Panel`, the shell's page card background and stub placeholders. |
| `Kbd` | The single keycap: `rounded-sm`, mono, `border-line-3`. Optional `label` for screen readers. | Replaces `help/_components/HelpCard.tsx`'s `Kbd` and the top bar's inline `<kbd>`. |
| `useSpotlight()` | A pointer-move hook that sets `--mx`/`--my` on the element. A `::before` radial gradient in `--hud-glow` follows the cursor. | One listener per card, on `pointermove` only, with no React state. Disabled under reduced motion and on touch (`pointer: coarse`). |

**Decorations are CSS, gated by scope.** Corner ticks (`.hud-ticks`), the spotlight (`.hud-spot`), the notch (`.hud-notch`) and the grid (`.hud-grid`) are defined as `.iq-hud .hud-…` rules in `globals.css` (`@layer components`). Outside the scope the classes do nothing.

**Notch implementation.** A clip-path polygon with an **18px** 45° cut top-right (replacing the 14px rounded corner). A rotated 2px span redraws the hairline along the diagonal. The inner `::after` is inset 1px with the card background, clipped to the same polygon offset by 1px. The diagonal keeps a hairline. Used only on: Up next, Readiness, Score tiles, Identity, the ⌘K palette.

**Existing primitives become thin wrappers** so most cards change without being touched:

- `components/patterns/Panel.tsx`: adds `hud-grid` and `rounded-lg`. Same API.
- `components/patterns/StatTile.tsx` / `StatRow`: render with `Readout`. Same API.
- `components/patterns/MonoPill.tsx`: `.iq-pill` goes to 2px inside the scope only (`.iq-hud .iq-pill`). Same API.
- `components/patterns/EmptyState.tsx`: radius tokens only.
- `components/ui/card.tsx`: `rounded-lg`. Shadcn API unchanged.
- `components/observability/ConsoleCard.tsx`: `ConsoleCard` renders `HudCard`, and `CardEmpty` renders `HudEmpty`. Same exports.

## 4. Card consolidation

The same "bordered card + title row" is built six times. All of them become `HudCard`:

| Today | Becomes |
| --- | --- |
| `dashboard/_components/ListCard.tsx` (`ListCard`, `ListEmpty`) | `HudCard` / `HudEmpty`. The file is deleted and its callers import from `components/hud`. |
| `profile/_components/ProfileCard.tsx` (`ProfileCard`, `CardEmpty`) | `ProfileCard` stays as a 1-line wrapper over `HudCard`, because it's used widely in profile details. `CardEmpty` → `HudEmpty`. |
| `help/_components/HelpCard.tsx` (`HelpCard`, `Kbd`) | `HudCard` + `components/hud` `Kbd`. The file is deleted. |
| `interviews/_components/SessionsList.tsx` `SessionGroup` frame | `HudCard` with `meta` = zero-padded mono count. |
| `components/observability/ConsoleCard.tsx` | Wrapper over `HudCard` (see 3). |
| `interviews/[sessionId]/_components/SessionDetail.tsx` details section | `HudCard`. |

**Header convention:** mono uppercase title, a leader line, then meta. Counts are zero-padded to 2 digits (`UPCOMING ──── 03`). The visible title text stays the same words, only styled. Accessible names come from `aria-labelledby` on the title, as today.

## 5. Shell and navbar search

**Top bar** (`components/layout/app-shell/AppTopBar.tsx`):

- The menu toggle, icon buttons and theme toggle go to `rounded-md`. The theme toggle becomes a 4px two-segment control. The avatar stays round.
- **Search field:** `rounded-md`, a mono `›` prompt glyph in place of the magnifier, placeholder unchanged, `Kbd` `⌘K` on the right. On hover/focus: corner ticks brighten to brand and a 2px brand caret rail appears on the left edge. The mobile icon button is unchanged apart from radius.

**Page card** (`AppShell.tsx`): `rounded-shell`, and a faint `hud-grid` under the content, low enough not to compete with cards.

**⌘K palette** (`components/layout/app-shell/CommandMenu.tsx`):

- Frame: `rounded-shell` + `hud-notch`, hairline border, existing overlay and shadow.
- Input row: mono `QUERY ›` label, the input with a brand caret, and `Kbd` `ESC` on the right.
- Results grouped under mono headers with counts: `SCREENS 08`, `ROLES 03`. Same data and ordering as today: screens first, then up to 6 roles.
- Active row: a 2px brand left rail + `bg-accent`. Row hint (`Go to`, `Roadmap`) as a mono right-aligned label.
- Footer readout: `↑↓ NAVIGATE · ↵ OPEN · ESC CLOSE` on the left, `11 RESULTS` on the right.
- No behaviour change: keyboard navigation, lazy JD fetch, remount-per-open, a11y titles and listbox semantics all stay as they are.

## 6. Section treatments

**Dashboard** (`app/(app)/dashboard/_components/`)

- `Greeting`: the date eyebrow becomes a mono readout `FRI 02 OCT · 12:30 IST`, with the local time zone abbreviation via `Intl`. Buttons go to `rounded-md`.
- `UpNextCard`: `HudCard tone="inverse" notch`. Header: `UP NEXT · {COMPANY} {LEVEL}` ── `StatusDot` (`live` when `LIVE_IN_PROGRESS` or `PREP_READY`, `idle` otherwise) + the existing status label. The chips become a readout strip `SLOT / LEVEL / TRACK`, with `TRACK` only when a specialization exists. The CTA goes to `rounded-md`. The hard-coded hex chip colours become inverse-tone tokens.
- `ReadinessCard`: `HudCard notch` + `SegmentMeter segments={4} filled={0}`. Text stays "Not started". No level names.
- `ScoreTiles`: notched `Readout` tiles, value `—`, an `idle` dot, and the "coming soon" notes kept verbatim.
- `RecentInterviews`: log-line rows: zero-padded index · round · company · mono date · `MonoPill` · `—` score.
- `LeaderboardCard`: `HudCard` + `HudEmpty`, same copy.

**Jobs** (`app/(app)/jobs/`)

- `CompanyCard`: `HudCard` body. `CompanyTile` goes to `rounded-md` (all sizes). The status pill becomes `StatusDot` `active` + `LIVE` or `idle` + `RESEARCHING`. `DepthMeter` renders `SegmentMeter` (5) with a `DEPTH n/5` readout plus the existing label. The CTA and the "Nothing to open yet" block go to `rounded-md`.
- `CompanyLibrary`: the search input and the All/Live/Researching control go to `rounded-md` (a segmented control with a 4px track).
- `RoleList`: the panels get `hud-grid`, the filter chips go to `rounded-md`, and role rows get a hover chevron rail. Compact `DepthMeter` → `SegmentMeter` compact.
- `[jobId]/Roadmap` + `RoundCard`: rounds become a vertical timeline. Each number tile becomes an `R01` mono node (`rounded-md`), with a 1px rail joining the nodes. Topic tags go to `rounded-sm` mono. `RoadmapHeader`'s `ReadinessMeter` → `SegmentMeter`, still "Not started". `InsightsTab` / `ProcessTab` frames → `HudCard`.

**Profile** (`app/(app)/profile/_components/`)

- `IdentityCard`: `HudCard notch`. Its two score slots become `Readout` `—`.
- `SummaryCard`: dot bullets become `›` mono markers, and the notable source tags go to `rounded-sm`.
- `SourceActivity` / visualizations: the frame goes to `HudCard`. The chart internals are unchanged apart from radius tokens.
- `details/EditableSection`, `ConnectedSourcesCard`, `ResumeFileRow`: on `ProfileCard` (→ `HudCard`), radius tokens.

**Connections** (`app/(app)/connections/_components/`)

- `SourceRow` / `SourceTile`: the tile goes to `rounded-md` mono. Rows get `StatusDot`: `active` for connected, `live` while syncing, `error` on a sync error, `idle` when not connected. The dot's state comes from the props/status `SourceList` already passes, so no new data is needed.
- `ConnectionsAside`: the count becomes `Readout` `02/04 SOURCES LINKED` + `SegmentMeter`. Notes unchanged.
- `LeetCodeRow`, `ResumeRow`, `ProviderRow`, `ConnectionButton`, `DisconnectDialog`: radius tokens.

**Interviews** (`app/(app)/interviews/`)

- `SessionsList`: `SessionGroup` → `HudCard` (§4). Rows become log lines with the meta in mono. `StatusPill` → `StatusDot` + mono label, mapping each status to `live` / `active` / `idle` / `error`.
- `BookingForm`: radius tokens. The step and choice tiles go to `rounded-md`.
- `[sessionId]/SessionDetail`: the progress panel becomes a step timeline (dot per step, rail between, current step brand). The details section → `HudCard`.
- `live/ChecksView`: the checks list becomes readout rows `MIC ── ● OK` (`StatusDot` from the existing check state). `PrejoinView`, `RoomFrame`, `LiveView`, `EndedView`: radius tokens. The timer becomes a mono readout.
- `report/ReportPlaceholder`: `HudEmpty` framing, same copy.

**Intelligence** (`app/(app)/intelligence/`): already console-shaped. `ConsoleCard` → `HudCard` covers most of it. Run/step states use `StatusDot` (via `components/observability/status.ts` → a dot-state mapping). `LogTerminal` / `LogStream` go to `rounded-md`. `agent/*` canvas nodes go to `rounded-md`. Other arbitrary radii → tokens.

**Help / Experiences**: `HelpCard` → `HudCard`. FAQ rows numbered `Q.01`. Keycaps use the shared `Kbd`. `ExperienceForm` / `ExperienceGuide`: radius tokens; the guide frame → `HudCard`.

**Stubs** (loops, practice, leaderboard, settings/*, admin/*): the shared placeholder becomes a `HudEmpty` on `hud-grid`, with each page's existing copy. If the Settings area (`2026-10-02-settings-design.md`) lands first, it builds on `HudCard` and the radius tokens instead of `ProfileCard`'s current look.

## 7. Motion

- Hover: ticks brighten and the spotlight follows the cursor. 150ms, `ease-iq`.
- Pulse: only `StatusDot live`, reusing the existing `iq-breathe` keyframes.
- Everything above is off under `prefers-reduced-motion` (existing `data-motion` convention + `motion-safe:` variants).
- No count-ups, scanlines or tickers.

## 8. Accessibility

- Decorations (ticks, spotlight, grid, notch, leader lines) are `aria-hidden` / pseudo-elements only.
- `StatusDot` always pairs with visible text or an `sr-only` label. Colour is never the only signal.
- `SegmentMeter` is `aria-hidden` when a text label sits beside it (as today). Otherwise it is `role="img"` with an `aria-label` (`Data depth 2 of 5`).
- Focus rings unchanged (`ring-1 ring-ring`). The search field's brand rail is extra, not a replacement.
- Mono uppercase labels use CSS `uppercase`, not uppercase source text, so screen readers don't spell them out.

## 9. Testing and verification

- **Unit (Vitest + Testing Library):**
  - `SegmentMeter`: fill count, clamping (`filled` < 0, > segments), and `aria-label` text.
  - `StatusDot`: state → classes/label mapping, and pulse present only for `live`.
  - `useHudScope`: adds/removes `iq-hud` on `<html>`.
  - `HudCard`: title/meta/action/footer render, `notch` class, `aria-labelledby`.
  - `HudEmpty`: tag + copy.
  - The `StatusPill` → dot mapping and the source-row dot-state mapping.
- **Existing tests updated, not deleted:** any assertion on removed classes or files. Known: `AppShell.test.tsx`, `AccountMenu.test.tsx`, `StatTile.test.tsx`, `EmptyState.test.tsx`, `CompanyCard.test.tsx`, `SessionsList.test.tsx`, `FaqList.test.tsx`, `PipelineCanvas.test.tsx`, `LeetCodeTopics.test.tsx`, `LanguageDistribution.test.tsx`. Behaviour assertions stay as they are.
- **Static checks:** `pnpm --filter web typecheck`, `lint`, `test` all pass.
- **Radius audit:** after the sweep, a grep for `rounded-\[` and bare `rounded` (no size suffix) in the scoped paths returns only the shared-component cases that are paired with a `hud:rounded-*` (§2). `rounded-full` remains only on avatars and dots, or paired with a `hud:` override.
- **Visual check (running app, light + dark):** dashboard, jobs, a roadmap, profile, connections, interviews list + a session, intelligence, help, experiences, one stub.
- **Under 90% zoom:** shell fills the window (no bottom gap); account menu, notifications popover, tooltips, dialogs, ⌘K and the disconnect dialog are positioned correctly. Checked in Chrome and Safari.
- **Out-of-scope check:** marketing, sign-in and an onboarding step render unchanged (radius 7/10px, no zoom, no ticks).

## Risks

- **Zoom + popper positioning — confirmed and fixed (2026-10-02).** Under `zoom` on `<html>`, Radix/floating-ui popups landed 10% off their trigger (≈140px left at 1440px). Fix in `globals.css`: `html.iq-hud [data-radix-popper-content-wrapper] { zoom: calc(1 / var(--hud-zoom)) }` and its child `{ zoom: var(--hud-zoom) }`, so placement is computed unzoomed while the content still renders at 90%. Verified: account menu and notifications popover align to their triggers (Δ ≤ 1px). Original note: Radix uses floating-ui. Standardized CSS `zoom` (Chrome 128+, Safari, Firefox 126+) applied to `<html>` scales the anchor and the popper together, so positions should hold. Verified per §9. Fallback if a browser misplaces poppers: drop the zoom from `--hud-zoom` (one token) and ship the rest. 90% is then raised again as a follow-up.
- **Wide sweep:** about 90 files change. Mitigation: primitives and wrappers first, then one section at a time, with typecheck + tests green after each.
- **Concurrent Settings work:** the settings spec builds on `ProfileCard`. `ProfileCard` is kept as a wrapper, so both changes compose.
