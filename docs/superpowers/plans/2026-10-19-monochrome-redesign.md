# Monochrome Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin and restructure every screen of `apps/web` into one monochrome ElevenLabs / fish.audio design language. The user journey, URLs, data and behaviour stay unchanged.

**Architecture:**
- **Foundation first:** new tokens, fonts and a small design-system folder (`components/ds/`).
- **Shim:** `components/hud` is temporarily re-exported from `ds`, so every unmigrated page already renders monochrome.
- **Shell:** the ElevenLabs-style shell comes next.
- **Pages:** then one task per page group, each importing from `ds` directly.
- **Cleanup:** the last task deletes the HUD layer, the shim and the retired tokens.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 3.4, shadcn (classic, new-york), next-themes, TanStack Query v5, lucide-react, `next/font/google`, `geist` (mono only), @xyflow/react, @monaco-editor/react, @excalidraw/excalidraw, recharts.

**Spec:** `docs/superpowers/specs/2026-10-18-monochrome-redesign-design.md`. Approved home mockup: `docs/superpowers/specs/2026-10-18-monochrome-redesign/home-dashboard-mockup.html`. Read both before any task. Section numbers below (§) refer to the spec.

## Global Constraints

- **Scope:** only `apps/web` changes. No API, contract, generated-type, hook, query-key, URL or behaviour change. Existing redirects stay.
- **Stack:** Tailwind 3.x (not 4) and shadcn classic. Before writing Next-specific code, read the relevant guide in `apps/web/node_modules/next/dist/docs/` (`apps/web/AGENTS.md`).
- **Dependencies:** no new runtime dependency. Fonts load through `next/font/google`. Anything else, an animation library for instance, means stop and ask the owner.
- **Light colours** (§3.1): page `#ffffff`, surface `#f7f7f6`, surface-2 `#f1f0ee`, stone `#f5f2ef`, line `#ebebea`, ink `#0b0b0b`, ink-2 `#4e4e4e`, ink-3 `#8a8781`.
- **Dark colours** (§3.1): page `#0e0e0d`, surface `#161615`, surface-2 `#1d1c1b`, stone `#1b1a18`, line `#242422`, ink `#f4f4f3`, ink-2 `#b4b2ae`, ink-3 `#7a7873`.
- **Hue:** the only hue allowed in chrome is a muted red `destructive`, for destructive confirms and error text only. There is no orange anywhere.
- **Elevation:** light is `inset 0 0 0 .5px rgb(0 0 0 / .075), 0 6px 16px rgb(78 50 23 / .04)`. Dark is `inset 0 0 0 .5px rgb(255 255 255 / .07)` plus `0 6px 16px rgb(0 0 0 / .4)`. Popovers and dialogs get one stronger float shadow. Nothing else casts a shadow.
- **Type:**
  - Display and headings: Inter Tight. Display is 48/1.08 at −0.035em, weight 300; page title 40/1.1, weight 300; section title 18, weight 500; card title 22–28, weight 400.
  - Body: Inter 400/500. The app base is 14px and the marketing body 16–18px.
  - Mono: Geist Mono, for code, kbd hints and numeric IDs only.
- **Radii:** pills (9999px) for buttons, search, chips, segmented controls and inputs. Tiles and table shells 16px, cards 20px, hero and CTA blocks 24–30px.
- **Spacing:** an 8px base. App content is max 1180px wide with 36px padding, and sections sit 40–44px apart. Marketing sections use 96–128px vertical rhythm.
- **Motion:** CSS only, with easing `cubic-bezier(.2,.7,.2,1)`. Tiles and cards lift 2–3px on hover. Colour fades take 150ms. Content fades up 8px on mount. Skeletons shimmer. Everything honours `prefers-reduced-motion`.
- **Scrollbars:** they stay hidden site-wide (product decision 2026-10-02).
- **Accessibility:** WCAG AA contrast in both themes. Darken ink-3 if it fails at body size. Every control gets a visible focus ring: a 2px ink ring with offset. Keep every existing aria-label.
- **Copy:**
  - Write "resume", never "résumé".
  - Readiness is "mock-interview readiness", never a badge, certificate or company endorsement (e.g. "Interview-ready · Meesho SDE I mock process").
  - Profile score and interview score stay visually separate, and the profile score keeps BETA.
  - The briefing shows only the interviewer, format, duration and pass mark.
- **Branding:** no ElevenLabs or Fish branding: no logo, no "ll" glyph, no product names, no imagery. No emoji, no stock gradient hero.
- **`(admin)`:** must not import the student app shell.
- **Working tree:**
  - Never commit. Leave all changes in the working tree, because the owner commits.
  - Another agent may edit this repo at the same time. Before overwriting a file, check its mtime against when you read it.
- **Tests:**
  - Do not run vitest, tsc or eslint unless the owner has asked for it in this session. Where a step says "Run", run it only with that permission, and otherwise report "not run (owner preference)".
  - Write new unit tests for the pure logic named in each task.
  - Update or delete existing tests that the change breaks, in the same task.
- **Visual check:** every task ends with one. Run the web app on the host, never Docker: `pnpm --filter @interviewiq/web dev`, with the API running for signed-in pages, signed in as a seeded persona from `apps/api/scripts/dev/`. Open each changed route at 1440px and 390px, in light and in dark. Confirm it matches the spec section and the mockup's language, then report what you checked.

## Review Focus

1. **A brand-new user** (no sessions, tracks, sources or score): every page shows a designed empty state, never a blank card, "—" soup or a layout collapse. Home in particular must look finished. Owned by Tasks 6, 7, 9, 11, 13, 14 and 15.
2. **Long or extreme content:**
   - long company or role names, a 120-character JD title, 30 tracks, 0 roles or 200 roles;
   - text truncates with a title attribute;
   - grids and tables keep their shape;
   - tables scroll horizontally inside their shell at 390px.
   Owned by the page tasks. Each one adds a long-content check to its visual check.
3. **Dark theme parity:** every surface, chart, flow node, Monaco, Excalidraw, dialog and toast is legible in dark mode, with no light-only literal colours left (`bg-white`, `text-black`, hex). Task 21 greps for these.
4. **Keyboard and focus:**
   - ⌘K, `M` and Esc still work, and stay suspended in the live room and while typing;
   - the collapsed sidebar is reachable by keyboard and has tooltips;
   - focus rings are visible on pill buttons in both themes.
   Owned by Task 5 (tests below) and checked in Task 12.
5. **Storage failure:** if localStorage throws or holds garbage, the sidebar opens expanded and the announcement shows. This happens in private mode and with old values. Owned by Task 5 (tests below).

---

## File map

**Create:**
- `components/ds/`: `Orb.tsx`, `Card.tsx`, `Chip.tsx`, `StatusDot.tsx`, `SegmentBar.tsx`, `Stat.tsx`, `Meter.tsx`, `EmptyState.tsx`, `PageHeader.tsx`, `SectionHeader.tsx`, `Carousel.tsx`, `Kbd.tsx`, `Count.tsx`, `index.ts`, `orb.test.ts`.
- `components/layout/app-shell/`: `Sidebar.tsx`, `SidebarInvite.tsx`, `TopBar.tsx`, `Breadcrumbs.tsx`, `AnnouncementStrip.tsx`, `announcement.ts`, `useSidebarCollapsed.ts`, `breadcrumbs.ts`, `shell.test.ts`.
- `features/interview-live/work/monacoThemes.ts`.

**Modify:**
- `app/globals.css`, `tailwind.config.js` and `app/layout.tsx`.
- `components/ui/*` (re-theme).
- `components/hud/index.ts` (shim, then deleted).
- `components/patterns/*` (restyle, or forward to `ds`).
- `components/layout/app-shell/*`.
- Every page under `app/` (per task).
- `features/loops/components/FlowCanvas.tsx`.
- `features/interview-live/**` (presentation only).
- `components/visualizations/*`.

**Delete (Task 21):**
- `components/hud/`;
- `app/(app)/interviews/[sessionId]/_components/prep-animation/` (Task 11);
- `components/layout/app-shell/AppMenu.tsx`, `AppTopBar.tsx` (Task 5);
- `components/layout/StubScreen.tsx` (Task 3);
- the HUD CSS, the `hud:` variant, and the `brand`, `cat-*`, `blob-*` and `--hud-zoom` tokens.

---

### Task 1: Tokens, fonts and Tailwind

**Files:**
- Modify: `app/globals.css` (`:root` and `.dark` token blocks, the base layer, and the components layer from line ~303)
- Modify: `tailwind.config.js`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces:
  - **Tailwind colours:** `surface`, `surface-2`, `stone`, `line` (same name, new value), `ink`, `ink-2`, `ink-3`.
  - **Kept shadcn semantic tokens, re-pointed:** `background` = page, `foreground` = ink, `muted` = surface, `muted-foreground` = ink-3, `secondary` = stone, `accent` = surface-2, `border`/`input` = line, `ring` = ink, `primary` = ink, `primary-foreground` = page, `card`/`popover` = page.
  - **Box shadows:** `ring` (the elevation) and `float` (popovers and dialogs).
  - **Border radius:** `tile` 16px, `card` 20px, `hero` 28px.
  - **Font families:** `sans` = Inter, `display` = Inter Tight, `mono` = Geist Mono.
  - **CSS utilities:** `.iq-grain` (SVG noise overlay through `::after`, 18% opacity), `.iq-fade-up` (8px rise on mount), `.iq-shimmer` (skeleton).
  - **Keyframes:** `iq-breathe`, `iq-shimmer` and `iq-fade-up`, all disabled under reduced motion.
  - **Chart and heatmap tokens:** `--chart-1..5` and `--heat-0..4` become a grey ramp from line (step 0) to ink (step 4), for both themes.
- Transitional (Task 21 removes these): `brand`, `brand-hover` and `brand-foreground` now equal ink, ink and page. `--hud-zoom` is fixed at `1`, and the `zoom` rule is removed. The `frame`, `panel`, `faint*` and `line-2..4` tokens are re-pointed to the nearest new grey, so unmigrated pages stay neutral.

- [ ] **Step 1:** In `app/layout.tsx`, replace `GeistSans` with `Inter({ subsets: ["latin"], variable: "--font-inter" })` and `Inter_Tight({ subsets: ["latin"], weight: ["300","400","500"], variable: "--font-display" })` from `next/font/google`. Keep `GeistMono`. Put all three `.variable` classes on `<html>`.
- [ ] **Step 2:** Rewrite the `:root` and `.dark` token blocks with the Global Constraints values, as HSL triplets, keeping every existing variable name that is still referenced. Delete the `cat-*` and `blob-*` tokens only after grepping that the cat is their sole user. The cat is deleted in Task 11, so leave them until then.
- [ ] **Step 3:** Update `tailwind.config.js` with the colours, shadows, radii and fonts listed under Produces. Keep the `hud:` variant for now.
- [ ] **Step 4:** Add the utilities and keyframes listed under Produces to the components layer. Make `html.iq-hud` set no zoom.
- [ ] **Step 5: Visual check.** Open `/dashboard`, `/jobs` and `/login` in both themes. Expect no orange, neutral greys, Inter text and nothing broken by the zoom removal. In particular, check that the popovers and the report ScoreRail sit correctly. Leave changes in the working tree.

### Task 2: The `ds` primitives

**Files:**
- Create: `components/ds/*` (as listed in the file map)
- Test: `components/ds/orb.test.ts`

**Interfaces:**
- Consumes: Task 1 tokens; `cn` from `@/lib/utils/cn`; `clampFilled` (moved from `components/hud/SegmentMeter.tsx` into `ds/SegmentBar.tsx` and re-exported).
- Produces (all exported from `@/components/ds`):
  - `orbVariant(seed: string): 0 | 1 | 2 | 3`. A stable, non-cryptographic string hash taken mod 4. The empty string returns 0.
  - `type OrbState = "still" | "breathing" | "listening" | "thinking" | "speaking"`.
  - `Orb({ seed?: string; variant?: 0|1|2|3; size?: number /* px, default 32 */; state?: OrbState; className?: string })`. A greyscale radial-gradient circle (the four variants follow the mockup's `.orb`, `.orb.b` and `.orb.c`, plus one more), `aria-hidden`. The states animate as follows:
    - `breathing`: a 4s scale of 1→1.04;
    - `listening`: a slow 6s breathe;
    - `thinking`: a slow rotate of the highlight;
    - `speaking`: a 0.9s pulse to 1.08.
  - `Card({ title?, meta?, action?, footer?, tone?: "default" | "stone" | "surface" | "ink"; interactive?: boolean; as?: "section" | "article" | "div" | "li"; titleAs?: "h1" | "h2" | "h3"; className?, children })`. `interactive` adds the hover lift. `ink` is the inverted card in both themes.
  - `Chip({ tone?: "default" | "ink" | "outline"; dot?: "filled" | "hollow" | "live"; children; className? })`.
  - `type DotState = "live" | "active" | "idle" | "warn" | "error"`; `dotClass(state: DotState): string`; `StatusDot({ state: DotState; label?: string })`. The states are monochrome:
    - `live`: an ink dot that pulses;
    - `active`: a solid ink dot;
    - `idle`: an ink-3 hollow dot;
    - `warn`: an ink-2 dot with a ring;
    - `error`: destructive.
  - `SegmentBar({ segments: number; filled: number; size?: "sm" | "md" | "lg"; label?: string; className? })` and `clampFilled`.
  - `Stat({ label, value, unit?, note?, size?: "sm" | "lg"; className? })`. Display font, weight 300, tabular numbers.
  - `Meter({ value: number /* 0..1, clamped */; mark?: number /* 0..1 pass tick */; label?: string; className? })`.
  - `EmptyState({ title, hint?, children?, orb?: boolean /* default true */; className? })`.
  - `PageHeader({ eyebrow?, title, description?, actions?, className? })`.
  - `SectionHeader({ title, href?: string /* adds chevron link */; actions?, className? })`.
  - `Carousel({ label: string; children; className? })`. Horizontal scroll-snap, with prev and next icon pills that scroll by one card width; the buttons are disabled at the ends.
  - `Kbd({ children })`.
  - `Count({ n: number; label?: string })`. Renders the plain number, unpadded, or "—" when it is not finite. Screen-reader text is the same as the HUD `Count`.

- [ ] **Step 1: Write the failing tests** in `orb.test.ts`:
  ```ts
  expect(orbVariant("")).toBe(0)
  expect(orbVariant("meesho")).toBe(orbVariant("meesho"))
  expect(new Set(["a","b","c","d","e","f","g","h"].map(orbVariant)).size).toBeGreaterThan(1)
  for (const s of ["x","amazon-sde1","🙂"]) expect([0,1,2,3]).toContain(orbVariant(s))
  expect(clampFilled(NaN, 4)).toBe(0); expect(clampFilled(9, 4)).toBe(4); expect(clampFilled(2.6, 4)).toBe(3)
  ```
- [ ] **Step 2: Run them, with permission.** `pnpm --filter @interviewiq/web exec vitest run components/ds/orb.test.ts` should FAIL with a missing module.
- [ ] **Step 3: Implement the primitives** with the signatures above. Use Task 1 tokens only, with no literal colours.
- [ ] **Step 4: Run the tests again, with permission.** Expect PASS.
- [ ] **Step 5: Visual check.** Build a temporary scratch route `app/(app)/_ds-preview/page.tsx` that renders every primitive and state in both themes. Compare it with the mockup, check reduced motion, then delete the route. Leave changes in the working tree.

### Task 3: Re-theme shadcn, the HUD shim and ComingSoon

**Files:**
- Modify: `components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `tabs.tsx`, `dialog.tsx`, `sheet.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `tooltip.tsx`, `badge.tsx`, `switch.tsx`, `checkbox.tsx`, `table.tsx`, `card.tsx`, `skeleton.tsx`, `sonner.tsx`, `custom-select.tsx`, `toggle-group.tsx`, `calendar.tsx`, `confirmation-dialog.tsx`
- Modify: `components/hud/index.ts` (shim)
- Modify: `components/patterns/*` (restyle; `EmptyState`, `PageHeader` and `StatTile` forward to `ds`)
- Delete: `components/layout/StubScreen.tsx` and `StubScreen.test.tsx`
- Create: `components/ds/ComingSoon.tsx`

**Interfaces:**
- Produces:
  - **`Button` variants:** `default` (an ink pill), `secondary` (a stone pill with the ring), `ghost`, `outline` (a page-colour pill with the ring), `destructive` and `link`. Sizes are `sm` 32px, `default` 40px, `lg` 48px and `icon` a 36px circle. The existing variant names stay valid, so call sites compile unchanged.
  - **`Tabs`:** a new `variant?: "pill" | "underline"` prop on `TabsList` and `TabsTrigger`. The default is `pill`, a segmented surface-2 control. `underline` is the ElevenLabs Explore tab style.
  - **`Input` and `CustomSelect`:** pill shaped, 40px high, with a hairline ring and an ink focus ring.
  - **`Dialog` and `Popover`:** the `card` radius and `float` shadow.
  - **The shim:** `components/hud/index.ts` re-exports `HudCard` = `ds/Card` (ignoring `notch`, `glow`, `active` and `spotlight`; mapping `tone: "inverse"` to `"ink"` and `"sunken"` to `"surface"`), `HudEmpty` = `ds/EmptyState` (ignoring `tag`), `Readout` = `ds/Stat`, `SegmentMeter` = `ds/SegmentBar` (ignoring `tone`), `StatusDot`/`dotClass`/`DotState`, `Kbd`, `Count`, and `padCount` (kept as is). `HudScope`, `HudZoomOff` and `useHudScope` become no-ops, and `HUD_CLASS` is kept. `spotlightMove` becomes a no-op.
  - **`ComingSoon({ title: string; hint?: string; href?: string; cta?: string })`:** an `EmptyState` inside the page frame. It replaces `StubScreen` at every call site, which are `practice` and the 9 admin stubs.

- [ ] **Step 1:** Restyle each `components/ui` file through tokens. Keep every export and prop name.
- [ ] **Step 2:** Write the shim. Make sure `components/hud/primitives.test.tsx` and `scope.test.tsx` still describe the shim's behaviour; delete any assertion about removed visuals (notch, ticks, zoom).
- [ ] **Step 3:** Create `ComingSoon`, swap it in at every `StubScreen` call site, and delete `StubScreen` and its test.
- [ ] **Step 4: Run, with permission.** `pnpm --filter @interviewiq/web exec vitest run components` should PASS.
- [ ] **Step 5: Visual check** of `/jobs`, `/loops`, `/settings/account`, `/practice` and `/admin/dashboard` in both themes. The pills, dialogs, tabs and toasts should all match the language. Leave changes in the working tree.

### Task 4: Data visuals (charts, heatmap, flow canvas, Monaco, Excalidraw)

**Files:**
- Modify: `components/visualizations/*`
- Modify: `components/ui/chart.tsx`
- Modify: `features/loops/components/FlowCanvas.tsx` and its node components
- Create: `features/interview-live/work/monacoThemes.ts`
- Modify: `features/interview-live/work/CodeEditor.tsx:148`, `features/interview-live/work/DiagramBoard.tsx`

**Interfaces:**
- Produces:
  - `defineIqThemes(monaco: Monaco): void`, which registers `iq-light` and `iq-dark`. These are monochrome: the background matches page or surface, keywords are ink and weight 600, strings are ink-2, comments are ink-3 italic, and the selection is surface-2.
  - `CodeEditor` uses `resolvedTheme === "dark" ? "iq-dark" : "iq-light"`, and calls `defineIqThemes` in `beforeMount`.
  - **FlowCanvas node states** (§5.3): `done` = ink fill with page-colour text, `ready` = an ink 1.5px ring, `locked` = a dashed line border with ink-3 text, `cooldown` = a hollow ring with the date chip. Info steps are dashed. The canvas background is a dotted paper pattern of line-coloured dots. Edges are ink-3, 1.25px.
  - `FlowCanvas` drops its `--hud-zoom` maths: the zoom is now always 1.
  - Excalidraw receives `theme={resolvedTheme}`.
- [ ] **Step 1:** Restyle the visualizations to the grey ramp. Series are told apart by shade and dash pattern, and the heatmap uses `--heat-0..4`.
- [ ] **Step 2:** Add the Monaco themes and the Excalidraw theme. Restyle the FlowCanvas nodes, edges and background.
- [ ] **Step 3:** Update `FlowCanvas.test.tsx` wherever it asserts the zoom maths or the old node classes. Run it, with permission.
- [ ] **Step 4: Visual check** of `/profile` (charts and heatmap), `/jobs/[jobId]` (the process flow), a process editor page, and the live room via the mock session if one is available. Check every node state in both themes. Leave changes in the working tree.

### Task 5: App shell

**Files:**
- Create: `components/layout/app-shell/` `Sidebar.tsx`, `SidebarInvite.tsx`, `TopBar.tsx`, `Breadcrumbs.tsx`, `AnnouncementStrip.tsx`, `announcement.ts`, `useSidebarCollapsed.ts`, `breadcrumbs.ts`, `shell.test.ts`
- Modify: `nav.ts`, `AppShell.tsx`, `AccountMenu.tsx`, `CommandMenu.tsx`, `VerifyEmailBanner.tsx`, `AppShell.test.tsx`, `AccountMenu.test.tsx`, `CommandMenu.test.tsx`
- Delete: `AppMenu.tsx`, `AppTopBar.tsx`

**Interfaces:**
- Produces:
  - **Nav groups.** `type NavGroupId = "main" | "build" | "you" | "admin"`. Each `AppNavItem` gains `group: NavGroupId`. `navGroupsFor(isAdmin: boolean): { id: NavGroupId; label: string | null; items: AppNavItem[] }[]` returns the groups in this order and with these items:
    - `main`, with no label: Home (`/dashboard`, keyword "dashboard"), Companies, Tracks (`/loops`), Interviews, Practice (`/practice`).
    - `build`, labelled "Build": Processes (`/processes`), Share experience.
    - `you`, labelled "You": Profile, Connections, Leaderboard (`/leaderboard`).
    - `admin`, labelled "Admin": Intelligence, Validation controls (`/admin/settings`). Only when `isAdmin`.
    Help is not in the groups: it is the bottom link. `navFor` and `APP_NAV` stay, as the flat list the CommandMenu uses.
  - **Breadcrumbs.** `breadcrumbsForPath(pathname: string, names?: { company?: string; role?: string; track?: string; process?: string }): { label: string; href?: string }[]`. The last crumb has no `href`. Mapping:
    - `/dashboard` → [Home]
    - `/jobs` → [Companies]
    - `/jobs/c/:slug` → [Companies, names.company ?? "Company"]
    - `/jobs/:id` → [Companies, names.company ?? "Company", names.role ?? "Role"]. The middle crumb links to the company only when it is known.
    - `/loops/:id` → [Tracks, names.track ?? "Track"]
    - `/processes/:id` → [Processes, names.process ?? "Process"]
    - `/interviews/:id` → [Interviews, "Interview"]
    - `/interviews/:id/report` → [Interviews, "Interview", "Report"]
    - `/settings/*` → [Settings, the tab name]
    - Any unknown path gives a single crumb from `titleForPath`.
  - **Announcement.** `ANNOUNCEMENT: { id: string; text: string; href?: string; linkText?: string } | null` lives in `announcement.ts`. The initial value is `null`. `isAnnouncementDismissed(id: string, storage?: Pick<Storage,"getItem">): boolean` and `dismissAnnouncement(id: string, storage?: Pick<Storage,"setItem">): void` store under the key `iq.announcement.dismissed`. Any throw counts as not dismissed.
  - **Sidebar collapse.** `useSidebarCollapsed(): [collapsed: boolean, setCollapsed: (v: boolean) => void]` uses the localStorage key `iq.sidebar.collapsed` with values `"1"` or `"0"`. Anything else, or a throw, means expanded.
  - **`AppShell` layout** (§4): the sidebar is 248px, or a 64px rail when collapsed. Below 1024px it becomes a `Sheet`. Then come the TopBar (60px, sticky, blurred), the announcement strip, the VerifyEmailBanner (a stone bar), and the content in a `max-w-[1180px] px-9 py-9` wrapper. The keys `M` (toggles collapse, or opens the sheet on mobile), ⌘K and Esc keep their current suspension rules.
  - **Sidebar bottom:**
    - the readiness summary moved from AppMenu: "N of M rounds completed", or "No official track started yet", plus a `SegmentBar`;
    - `SidebarInvite`, dismissible under the key `iq.invite.dismissed` with the same storage-safe helpers, linking to `/for-colleges`;
    - Help;
    - the account row: an `Orb` seeded by the user id, the name and the level label, which opens `AccountMenu`.
  - **TopBar:** sidebar toggle, `Breadcrumbs`, a pill search (opens CommandMenu, "Search companies, roles, interviews…", ⌘K), Feedback (`/contact`), Help (`/help`), the notifications popover (unchanged content), and the avatar `Orb` opening `AccountMenu`. The ThemeToggle is not in the TopBar; AccountMenu keeps its Light/Dark items.
  - **CommandMenu:** restyled with a `card` radius, `float` shadow and pill input. Same groups and behaviour.

- [ ] **Step 1: Write the failing tests** in `shell.test.ts`:
  - `navGroupsFor(false)` has no admin group, and its main items are exactly `["Home","Companies","Tracks","Interviews","Practice"]`.
  - `navGroupsFor(true).at(-1)` has id `"admin"` and includes "Validation controls".
  - `breadcrumbsForPath("/jobs/abc", { company: "Meesho", role: "SDE I" })` equals `[{label:"Companies",href:"/jobs"},{label:"Meesho"},{label:"SDE I"}]`. Without a slug the company crumb has no href.
  - `breadcrumbsForPath("/interviews/x/report")` labels are `["Interviews","Interview","Report"]`.
  - `breadcrumbsForPath("/nowhere")` has length 1.
  - `isAnnouncementDismissed("a", { getItem: () => { throw new Error() } })` is `false`.
  - `isAnnouncementDismissed("a", { getItem: () => "garbage" })` is `false`.
  - After `dismissAnnouncement("a", mem)`, `isAnnouncementDismissed("a", mem)` is `true`, and `"b"` is still `false`.
  - The `useSidebarCollapsed` storage parse: `"1"` → true; `"0"`, `"yes"`, `null` or a throw → false. Export `parseCollapsed(raw: string | null): boolean` and test it.
- [ ] **Step 2: Run them, with permission.** Expect FAIL.
- [ ] **Step 3: Implement** the files above. Pages pass their names into `Breadcrumbs` through a small context, `useBreadcrumbNames(names)`, exported from `Breadcrumbs.tsx`. Pages that know a company, role, track or process name call it.
- [ ] **Step 4: Update** `AppShell.test.tsx`, `AccountMenu.test.tsx` and `CommandMenu.test.tsx` for the new structure, keeping their shortcut and suspension assertions. Run them, with permission. Expect PASS.
- [ ] **Step 5: Visual check:**
  - Compare the sidebar and top bar with the mockup at 1440px, in both themes.
  - Collapse to the rail and reload: it should persist.
  - At 390px the sidebar should be a sheet.
  - The keyboard should reach every item, and the rail should show tooltips.
  - `M`, ⌘K and Esc should work, and should do nothing on `/interviews/[id]/live`.
  - Set a temporary `ANNOUNCEMENT`, dismiss it and reload: it should stay dismissed. Then reset it to `null`.
  Leave changes in the working tree.

### Task 6: Home (`/dashboard`)

**Files:**
- Modify: `app/(app)/dashboard/_components/Dashboard.tsx` and its children (`UpNextCard`, `ReadinessCard`, `CalendarCard`, `RecentInterviews`)
- Delete: `ScoreTiles` and `LeaderboardCard` (and any tests)
- Create: `QuickTiles.tsx`, `CompaniesCarousel.tsx` in the same folder

**Interfaces:**
- Consumes: `ds/*`; the existing `useMySessions`, `useLoops` and `useCurrentUser`; `useJobCompanies` and `useJds` from `features/jobs`; the session fields `score`, `outcome`, `passMark` and `retakeAfter`.
- Produces: the page as §5.1 and the mockup describe, in this order: header → QuickTiles → [Up next | Readiness] → [Calendar | This week] → Recent results (a DataTable) → CompaniesCarousel ("Researched processes").
- [ ] **Step 1: Header.** Use the existing primary-action logic unchanged: the next session, else a ready loop, else `/interviews`. The greeting depends on the local hour: "Good morning" before 12, "Good afternoon" before 17, "Good evening" after. The eyebrow is the date formatted like "Saturday, 18 October".
- [ ] **Step 2: QuickTiles.** Six tiles with the hrefs from §5.1. Only "Find a role" shows a live count ("{n} open roles", from `useJds`); while loading or on error it shows static copy.
- [ ] **Step 3: Up next and Readiness.**
  - Up next: a stone `Card` with an `Orb` glow. Its empty state is an `EmptyState` with a "Schedule a round" CTA.
  - Readiness: track rows with a `SegmentBar` and level wording, and the note "Counts unedited processes only."
- [ ] **Step 4: Calendar and agenda.** Restyle the Calendar and keep its behaviour. Add the "This week" list from the same sessions data.
- [ ] **Step 5: Recent results.** A DataTable with the columns round, track, date, score `x.x /10`, outcome chip and a row link to the report. The outcome chips:
  - Passed;
  - "Retake {d MMM}" (below pass, with a date);
  - "Retake now" (below pass, no date);
  - "Not scored" (unscorable).
  Keep the skeleton, error and empty states.
- [ ] **Step 6: CompaniesCarousel.** Use the live companies from `useJobCompanies`, in API order. Each card has grain art (`.iq-grain`) built from an `Orb` variant seeded by the slug, plus the name, the role count and an arrow, and links to `/jobs/c/[slug]`. Hide the section when there are zero companies.
- [ ] **Step 7: Visual check.** Compare with the mockup at 1440px in both themes. Check a new persona with no data (Review Focus 1), long names (Review Focus 2), and 390px. Leave changes in the working tree.

### Task 7: Companies and company roles

**Files:**
- Modify: `app/(app)/jobs/_components/CompanyLibrary.tsx`, `CompanyCard.tsx`, `CompanyTile.tsx`, `CompanyRoles.tsx`, `RoleCard.tsx`, `MatchPill.tsx` and their filter components

**Interfaces:**
- Consumes: `ds/*`, `Tabs variant="pill"` (Task 3), `useBreadcrumbNames` (Task 5).
- Produces (§5.2):
  - **`/jobs`:** a `PageHeader` "Companies"; a pill search plus an All/Live/Researching pill segment; a 3–4 column grid of company cards (logo square or `Orb`, name, status `Chip`, role count, and on hover or focus "View roles" plus the primary JD CTA). Keyboard focus shows the same actions.
  - **`/jobs/c/[slug]`:** a company header (a grain art tile, HQ, size, role count); a sticky filter bar where the level chips are pill toggles and "More filters" opens an inline panel (all filters stay URL-driven); role cards in level groups.
  - **`MatchPill`:** a `Chip`, using `outline` for a stretch role.
- [ ] **Step 1:** Restyle the Companies library, keeping every state: skeleton, error with retry, "No companies yet", and "No companies match" with Clear filters.
- [ ] **Step 2:** Restyle Company roles and call `useBreadcrumbNames({ company })`. Keep every filter, the sort, "Set your level" and every state.
- [ ] **Step 3: Visual check:** 0 roles; 200 roles; a long name; the filter panel open; 390px; both themes. Leave changes in the working tree.

### Task 8: Role detail (`/jobs/[jobId]`)

**Files:**
- Modify: `app/(app)/jobs/[jobId]/_components/Roadmap.tsx`, `RoadmapHeader.tsx`, `PublishedDetails.tsx`, `ProcessTab.tsx`, `ProcessFlow.tsx`, `RoundCard.tsx`, `InsightsTab.tsx`, `MatchTab.tsx`

**Interfaces:**
- Consumes: `ds/*`, `Tabs variant="underline"`, the FlowCanvas styles (Task 4), `useBreadcrumbNames({ company, role })`.
- Produces (§5.2):
  - **Hero:** title, meta, match `Chip`, readiness state, and the actions Open/Start track, Duplicate & customise, Add to targets/Watching.
  - **Layout:** underline tabs, with About and Role details in a right column at ≥1280px and stacked below the tabs under that.
  - **Match tab:** the % as a `Stat`, then five `Meter` rows with evidence `Chip`s.
- [ ] **Step 1:** Hero and layout.
- [ ] **Step 2:** The Process tab:
  - the flow card;
  - round cards (tiles, topics, both disclosures, "Book this round");
  - info steps dashed;
  - the empty state "No interview data yet" with "Book a round".
- [ ] **Step 3:** The Insights reading layout, and the Match tab with all its states.
- [ ] **Step 4: Visual check:** a template JD (no CTC, "Practice only"); a JD with no process; both themes; 390px. Leave changes in the working tree.

### Task 9: Tracks hub, loop dashboard and booking dialogs

**Files:**
- Modify: `app/(app)/loops/_components/LoopsHub.tsx`, `LoopsTab.tsx`, `LoopCard.tsx`, `ScheduleTab.tsx`, `TargetsTab.tsx`, `LoopDetail.tsx`
- Modify: `features/loops/components/SlotDialog.tsx` (BookRoundDialog, RescheduleDialog, SlotPicker)

**Interfaces:**
- Consumes: `ds/*`, `Tabs variant="pill"` (still `?tab=`), FlowCanvas (Task 4), `useBreadcrumbNames({ track })`.
- Produces (§5.3):
  - **Stats:** 4 `Stat` tiles.
  - **Track rows:** `Orb`, JD title, `SegmentBar`, next-round CTA, and an overflow `DropdownMenu` (Pause/Resume, Abandon with confirm).
  - **Schedule:** a DataTable.
  - **SlotPicker:** pill day chips and pill hour chips.
  - **Loop detail:** header chips, "X of Y rounds completed" with an `lg` `SegmentBar` and the readiness line, the flow card, and the interviews DataTable.
- [ ] **Step 1:** The hub and its three tabs, with every action and empty state ("No tracks yet", "Nothing booked", "Nothing on your watchlist."), and show/hide for finished tracks.
- [ ] **Step 2:** Restyle the dialogs, keeping their behaviour.
- [ ] **Step 3:** Loop detail, including the 404 "This track doesn't exist" and the generic error.
- [ ] **Step 4: Visual check:** 0 tracks; 30 tracks; a paused track; an abandoned track; a track in cooldown; both themes; 390px. Leave changes in the working tree.

### Task 10: Processes list and process editor

**Files:**
- Modify: `app/(app)/processes/_components/ProcessesPage.tsx`, `ProcessList.tsx`, `CreateProcessDialog.tsx`, `ProcessEditor.tsx`, `NodePalette.tsx`, `Inspector.tsx`, `ProcessEditor.test.tsx`

**Interfaces:**
- Consumes: `ds/*`, FlowCanvas edit mode (Task 4), `useBreadcrumbNames({ process })`.
- Produces (§5.3):
  - **List:** a grid of process cards with an overflow menu (Edit, Start track, Duplicate, Delete with confirm), plus the unrecognized-level warning `Chip`.
  - **Editor:** full screen, with three floating rounded panels (`Card tone="default"`, `float` shadow) over the dotted canvas, and a pill header (back with leave-confirm, name, level, Saved/Unsaved `Chip`, Save, Start track).
- [ ] **Step 1:** The list and Create dialog, with every state.
- [ ] **Step 2:** The editor panes. Remove the HUD zoom use (`useHudScope`/`HudZoomOff`) and update `ProcessEditor.test.tsx` to match. Run it, with permission.
- [ ] **Step 3: Visual check:** drag a preset; connect; delete; trigger a validation alert; the replace confirm; both themes. Leave changes in the working tree.

### Task 11: Interviews, session detail and prep (cat removal)

**Files:**
- Modify: `app/(app)/interviews/_components/BookingForm.tsx`, `SessionsList.tsx`
- Modify: `app/(app)/interviews/[sessionId]/_components/SessionDetail.tsx`, `PrepPanel.tsx`, `PrepFailed.tsx`, `BriefingCard.tsx`
- Delete: `app/(app)/interviews/[sessionId]/_components/prep-animation/` and the `--cat-*` tokens in `app/globals.css`

**Interfaces:**
- Consumes: `ds/*` (`Orb state="breathing"`), the existing hooks.
- Produces:
  - **`/interviews`** (§5.4): two columns at ≥1024px, stacked below that. On the left, a "Book a round" composer in a stone `Card` with the role select, practice-template checkbox, round chips, a Start now / Schedule toggle, day chips, the "Later" calendar popover, hour chips 09–18 and one primary CTA. On the right, Upcoming and Past lists, with the row action chosen by status. `?jd` and `?round` prefill still works.
  - **Session detail:** a hero (round title, status `Chip`, SessionAction). The BriefingCard becomes an interviewer card: a large `Orb` seeded by the interviewer name, name, style, format, duration and pass mark only. Below it, Details and a vertical progress timeline.
  - **PrepPanel** (§5.6): a breathing `Orb` (size 96) above the five steps. The current step is ink, done steps have a filled dot, later steps are ink-3, and the timings are unchanged.
- [ ] **Step 1:** Delete `prep-animation/` and `--cat-*`. Grep that nothing imports them, and make PrepPanel's only import change the removal.
- [ ] **Step 2:** Build the new PrepPanel and restyle PrepFailed (RetryPrepButton, Details).
- [ ] **Step 3:** The booking composer and the sessions list, with every state.
- [ ] **Step 4:** Session detail, the briefing and the timeline.
- [ ] **Step 5: Visual check:** booking with no roles; prefill from a role page; a prep in flight; prep failed; a finished session ("Practise again"); both themes; 390px. Leave changes in the working tree.

### Task 12: Live room (presentation only)

**Files:**
- Modify: `app/(app)/interviews/[sessionId]/live/_components/LiveRoom.tsx`, `LiveInterview.tsx`, `LiveView.tsx`, `PrejoinView.tsx`, `ChecksView.tsx`, `FullscreenGate.tsx`, `EndedView.tsx`
- Modify: `features/interview-live/room/RoomStage.tsx`, `media/InterviewerStrip.tsx` (+ test), `panel/ProblemPanel.tsx`, `controls/BottomBar.tsx`, `RoomHeader`, `ProctorBars`, `TranscriptBubbles`, `ToolRail`

**Interfaces:**
- Consumes: `AgentState` (`features/interview-live/session/types.ts:12`), `Orb` (Task 2), the Monaco and Excalidraw themes (Task 4).
- Produces (§5.5):
  - **The interviewer orb.** `agentStateToOrb(s: AgentState): OrbState`, exported from `InterviewerStrip.tsx`. The mapping is `absent` → "still", `initializing` → "breathing", `listening` → "listening", `thinking` → "thinking", `speaking` → "speaking". The orb is size 160 on the stage and size 40 in the compact layout.
  - **The rest of the room:**
    - caption-style transcript;
    - a small rounded self-view;
    - an icon-pill tool rail;
    - rounded card panels;
    - a floating centred pill bottom bar (mic and End interview), with destructive styling only inside the confirm;
    - a slim header with a `StatusDot state="live"`, counter `Chip`s and the elapsed clock;
    - proctor bars as slim ink banners with their countdowns.
  - **No changes to:** the state machine, the proctoring, the fullscreen logic, the guards, the shortcut suspension or any session wiring.
- [ ] **Step 1: Write a failing test** in `InterviewerStrip.test.tsx`: `agentStateToOrb` maps all five states exactly as above. Run it, with permission. Expect FAIL.
- [ ] **Step 2:** Implement the orb and the stage. Run the test, with permission. Expect PASS.
- [ ] **Step 3:** Restyle the prejoin, checks, fullscreen gate, live view, work area and ended view.
- [ ] **Step 4: Visual check** through the mock session (`MockLiveSession`) or the dev flow:
  - every orb state;
  - code and whiteboard in both themes;
  - a proctor countdown;
  - reconnecting;
  - every ended reason;
  - that ⌘K and `M` do nothing.
  Leave changes in the working tree.

### Task 13: Report (`/interviews/[sessionId]/report`)

**Files:**
- Modify: `app/(app)/interviews/[sessionId]/report/_components/ReportView.tsx`, `ScoreRail.tsx`, `OverviewCard.tsx`, `ScoreBuildUp.tsx`, `QuestionsSection.tsx`, `QuestionCard.tsx`, `CodeAnswer.tsx`, `BoardAnswer.tsx`, `WorkOnSection.tsx`, `DeliverySection.tsx`, `ConductSection.tsx`, `TranscriptSection.tsx`, `DisputeControl.tsx`, `DisputeDialog.tsx`, `ReportEvaluating.tsx`, `ReportUnscorable.tsx`

**Interfaces:**
- Consumes: `ds/*` (`Stat`, `Meter` with `mark`, `Chip`, `Orb`).
- Produces (§5.7):
  - **The sticky left rail:** the score as "7.4 / 10" in display type, weight 300; a `Meter` with the pass-mark `mark`; the outcome `Chip` and verdict; the gating CTA (same rules and labels); and the vertical section nav with an active marker.
  - **The right column:** the sections in today's order.
  - **Evaluating:** a breathing `Orb`.
  - **"Question this score":** a ghost pill.
  - Remove `ScoreRail`'s `--hud-zoom` maths.
- [ ] **Step 1:** The rail and the layout.
- [ ] **Step 2:** The sections, keeping every subsection, the "Jump to moment" anchors, the transcript filters and the expandable code and board answers.
- [ ] **Step 3:** The dispute dialog and its statuses (pending, upheld, revised), keeping the limits copy.
- [ ] **Step 4: Visual check** of every state: evaluating, failed, legacy, unscorable, passed, below pass with a date, and below pass "Retake now". Check a 3-dispute-used report, both themes and 390px (the rail stacks on top). Leave changes in the working tree.

### Task 14: Profile and connections

**Files:**
- Modify: `app/(app)/profile/_components/ProfileView.tsx` and its section components
- Modify: `features/profile-scoring/components/ProfileScoreCard.tsx`
- Modify: `app/(app)/connections/page.tsx` and `_components/*` (ConnectionsGrid, the rows, the dialogs, ConnectionsAside)

**Interfaces:**
- Consumes: `ds/*`. ConnectionsGrid is also rendered by onboarding step 3, so the restyle must look right in both places.
- Produces (§5.8):
  - **Profile header:** a size 72 `Orb` seeded by the user id, name, headline, level `Chip`, and the profile score as a `Stat` with a BETA `Chip`.
  - **Profile body:** two columns of hairline `Card`s, every section still editable.
  - **Connections:** provider rows (logo square, name, status `Chip`, action pill), restyled dialogs, and "How sources are used" as a side `Card`.
- [ ] **Step 1:** Profile, keeping every editable section, the empty hints and the ProfileScoreCard controls (opt-in Switch, Recalculate, Refresh, warnings).
- [ ] **Step 2:** Connections: every provider, every sync `Chip` state, the GitHub `?error=` mapping, and the LinkedIn import and review flow.
- [ ] **Step 3: Visual check:** a profile with no sources; every sync state; the LinkedIn dialog steps; both themes; 390px. Leave changes in the working tree.

### Task 15: Experiences, leaderboard, help, practice and settings

**Files:**
- Modify: `app/(app)/experiences/*`, `leaderboard/*` (ProfileLeaderboard), `help/page.tsx` (+ FaqList), `practice/page.tsx`, `settings/layout.tsx`, `settings/_components/SettingsNav.tsx`, `AccountSettings.tsx`, `NotificationSettings.tsx`, `PrivacySettings.tsx`, `settings/billing/page.tsx`

**Interfaces:**
- Produces (§5.8):
  - **Settings:** a left sub-nav inside the page, collapsing to a pill segment below 1024px. Rows of label, description and control, in `Card`s. Delete account is a destructive `Card` at the bottom.
  - **Leaderboard:** a pill level segment, the opt-in line, and a DataTable with an `Orb` and name per row.
  - **Help:** a plus-icon accordion and a `Kbd` shortcuts card. The shortcuts list is updated: `M` now reads "Collapse or expand the menu".
  - **Practice:** `ComingSoon` with the title "Practice is coming soon", the hint "Targeted practice from your interview gaps." and a link to Companies.
- [ ] **Step 1:** Experiences (the form card and guide panel) and the leaderboard, with its small-cohort empty state and Retry.
- [ ] **Step 2:** Help and practice.
- [ ] **Step 3:** Settings: all four tabs with every control. The email-paused state, the export button and the delete flow stay unchanged.
- [ ] **Step 4: Visual check:** both themes and 390px for each page. Leave changes in the working tree.

### Task 16: Auth

**Files:**
- Modify: `app/(auth)/layout.tsx`, `_components/AuthSplit.tsx`, `RoundsPanel.tsx`, `AuthColumn`, `AuthHeading.tsx`, `GoogleButton.tsx`, `PasswordInput.tsx`, `SubmitButton.tsx`, `FormAlert.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`, `VerifyEmailStatus.tsx`
- Modify: `app/auth/callback/page.tsx`

**Interfaces:**
- Produces (§5.9):
  - **The split:** a left form column (max 400px, vertically centred). Its elements are the logo, a display heading, Google first as a full-width outline pill, an "or" hairline divider, pill inputs and a primary pill submit.
  - **The right panel:** rounded, `hero` radius, with a black `.iq-grain` gradient. It holds a size 280 drifting `Orb` and the RoundsPanel's sample lines rotating one at a time. It is hidden below 1024px.
  - **Single-column flows:** a centred `Card`.
  - **ThemeToggle:** moved to the footer corner.
- [ ] **Step 1:** The layout, the split and the right panel.
- [ ] **Step 2:** The five forms and the callback, keeping every field, message, query parameter and redirect.
- [ ] **Step 3: Visual check:** every validation and server error state; `?error=oauth`; reset with a missing token; verify success and error; both themes; 390px. Leave changes in the working tree.

### Task 17: Onboarding

**Files:**
- Modify: `app/(onboarding)/layout.tsx`, `features/onboarding/components/OnboardingWizard.tsx`, `OnboardingSteps.tsx`, `ResumeUpload.tsx`, `ParsedSummary.tsx`, `PersonalFields.tsx`, `EducationExperienceFields.tsx`, `SectionFields.tsx`, `HighlightsEditor.tsx`, `SkillsInput.tsx`, `TargetPicker.tsx`, `ProfilePreview.tsx`, `DraftStatus`

**Interfaces:**
- Produces (§5.10):
  - **Top bar:** slim, with the logo, a 4-segment `SegmentBar size="md"` labelled Resume · Profile · Sources · Target, the draft status and Sign out.
  - **Steps:** a centred column (max 640px) with display titles: "Start with your resume", "Check your profile", "Connect your work", "Where are you headed?".
  - **Footer:** a sticky bar with Back, "Skip for now" (where it exists today) and the primary pill.
  - **ProfilePreview:** a floating right card at ≥1280px, and a "Preview" drawer (`Sheet`) below that.
  - **Upload zone:** a dashed `hero`-radius drop zone with `Orb state="breathing"` while parsing.
- [ ] **Step 1:** The layout, the steps bar and the footer.
- [ ] **Step 2:** The four steps, keeping every field, required rule, step memory, draft state, toast and alert. The step 3 ConnectionsGrid comes from Task 14.
- [ ] **Step 3: Visual check:**
  - a full run as a fresh signup;
  - resume parse success and failure;
  - "Continue without resume";
  - skipping sources and target;
  - finishing with a target (lands on `/jobs/{id}`);
  - both themes; 390px.
  Leave changes in the working tree.

### Task 18: Marketing shell and landing page

**Files:**
- Modify: `app/(marketing)/layout.tsx`, `_components/MarketingHeader.tsx`, `MobileNav.tsx`, `MarketingFooter.tsx`
- Modify: `_components/landing/*` (Hero, SignupForms, SourceStack, FeatureRow, ResearchPanel, InterviewDemo, DebriefPanel, HowItWorks, LayerArt, ReadinessTimeline, WhyCards, Universities, Accordion, Personas, PersonaCarousel, ClosingCta, Faq, LandingMotion, primitives)

**Interfaces:**
- Consumes: `content.ts`, unchanged. Every anchor id stays: `#product`, `#interview`, `#debrief`, `#how`, `#readiness`, `#universities`.
- Produces (§5.11):
  - **Header:** transparent and sticky, getting a hairline after 8px of scroll, with a ghost "Log in" and an ink pill "Start free".
  - **Hero:** a centred light display headline, a subline, the email pill form plus Google, and below it the demo widget.
  - **The demo widget:** `InterviewDemo` becomes a stone card with sample company chips. Choosing a chip swaps the scripted sample question, with `Orb state="speaking"` while the text types, then signal chips. No audio and no API calls.
  - **Sections in order:** the wordmark strip (greyscale, slowly scrolling, paused under reduced motion); the three feature rows with grain art; How it works; the readiness timeline; Why as a bento grid; Universities as a stone panel; the Personas carousel (`ds/Carousel`); the closing CTA as a black grain panel with an `Orb`; the FAQ; and a multi-column footer.
  - **LandingMotion:** keeps reveal and count, and removes scramble.
- [ ] **Step 1:** The header, mobile nav and footer.
- [ ] **Step 2:** The hero and the demo widget.
- [ ] **Step 3:** The remaining sections in order.
- [ ] **Step 4: Visual check:** the full scroll at 1440px, 1024px, 768px and 390px in both themes; reduced motion; every anchor link from the header. Leave changes in the working tree.

### Task 19: Marketing sub-pages

**Files:**
- Modify: `app/(marketing)/about/page.tsx`, `contact/page.tsx`, `for-colleges/page.tsx`, `pricing/page.tsx`

**Interfaces:**
- Consumes: the Task 18 section patterns. The content is unchanged, including the contact page's unset-email message and the "Plans are being finalised." copy.
- [ ] **Step 1:** Restyle all four pages with the same section rhythm and cards.
- [ ] **Step 2: Visual check:** both themes and 390px. Leave changes in the working tree.

### Task 20: Intelligence and the admin group (restyle only)

**Files:**
- Modify: `app/(app)/intelligence/page.tsx` and `_components/**` (tabs, tables, timelines, TraceTree, LogTerminal, the enrichment editor, RoundsCanvas, GraphMiniMapInner)
- Modify: `app/(admin)/layout.tsx`, `admin/settings/ValidationControlsPanel.tsx`

**Interfaces:**
- Produces (§5.8):
  - **Intelligence:** underline tabs (still `?tab=`); tables, timelines and trace trees on the new tokens; LogTerminal dark in both themes. Remove the `--hud-zoom` maths in `RoleEditor.tsx`, `RoundsCanvas.tsx` and `GraphMiniMapInner.tsx`, and update `RoleEditor.test.tsx`.
  - **The `(admin)` layout:** drops `HudScope`, never imports the student shell, and keeps `RequireAdmin`.
- [ ] **Step 1:** Restyle each Intelligence tab without moving any control.
- [ ] **Step 2:** The admin layout and the validation panel.
- [ ] **Step 3: Visual check** of each tab with data and empty, in both themes. Leave changes in the working tree.

### Task 21: Remove the HUD layer, then a final sweep

**Files:**
- Delete: `components/hud/` (including `primitives.test.tsx` and `scope.test.tsx`)
- Modify: every file still importing `@/components/hud` (point it to `@/components/ds`)
- Modify: `app/globals.css` (remove `html.iq-hud`, the tick, notch, ember and spot rules, `.iq-eyebrow`/`.iq-h2` if unused, `--hud-zoom`, `--u` if unused, `brand*`, `blob-*` and `frame`/`panel`/`faint*` if unused)
- Modify: `tailwind.config.js` (remove the `hud:` variant and unused colours)
- Modify: `app/layout.tsx` (keep the `geist` import for mono only)
- Modify: `components/auth/RequireAuth.tsx`, `RequireAdmin.tsx`, `OnboardingGate.tsx` (drop the `--hud-zoom` uses)
- Modify: `/CLAUDE.md` (the frontend line: drop "UI follows the Claude Design export…" and point to the spec), plus the memory note `feedback_design_language.md` (status: shipped)

- [ ] **Step 1:** Repoint every remaining `@/components/hud` import. `HudCard` becomes `Card` and `Readout` becomes `Stat`; drop the props that no longer exist.
- [ ] **Step 2:** Delete the folder, the CSS, the variant and the tokens.
- [ ] **Step 3: Grep.** Each of these must return nothing:
  - `rg "components/hud|iq-hud|hud-zoom|hud:|bg-brand|text-brand|--brand|--cat-|StubScreen" apps/web --glob '!node_modules'`;
  - `rg "bg-white|text-black|#[0-9a-fA-F]{3,6}\b" apps/web/app apps/web/components apps/web/features --glob '*.tsx'`. Allowed exceptions: Monaco themes, the orb gradients, and the LogTerminal, each with a one-line comment.
- [ ] **Step 4: Run, with permission:** `pnpm --filter @interviewiq/web typecheck`, `pnpm --filter @interviewiq/web exec vitest run` and `pnpm --filter @interviewiq/web build`. All should pass.
- [ ] **Step 5: Full visual sweep.**
  - Walk the journey in both themes as a new persona: signup → onboarding → a company → a role → start a track → book a round → prep → the live room (mock) → the report.
  - Then visit every other route once.
  - Check Review Focus 1–5 explicitly.
  - List anything off-language with its route.
- [ ] **Step 6:** Update `CLAUDE.md` and the memory note. Leave all changes in the working tree for the owner to commit.

### Task 22: The bars mascot (runs right after Task 11)

**Files:**
- Create: `components/mascot/BarsMascot.tsx`, `components/mascot/forms.ts`, `components/mascot/mascot.test.ts`
- Modify: `app/(app)/interviews/[sessionId]/_components/PrepPanel.tsx`, `PrepFailed.tsx`; `report/_components/ReportEvaluating.tsx`, `ScoreRail.tsx` (or wherever "passed" first renders); `live/_components/EndedView.tsx`; `app/globals.css` (mascot keyframes, in the keyframes area, reduced-motion safe)

**Interfaces:**
- Consumes: spec §5.6. The visual reference is `.superpowers/brainstorm/87486-1792346878/content/mascot-bars-v2.html`; copy its SVG geometry, eyes, keyframes and mood poses, and refine them.
- Produces:
  - `type MascotForm = "trio" | "hopper" | "jelly" | "bloom"`
  - `type MascotMood = "idle" | "listening" | "thinking" | "laughing" | "oops" | "speaking"`
  - `MORPH_LOOP: MascotForm[] = ["trio","hopper","jelly","bloom"]` and `nextForm(f: MascotForm): MascotForm`, which wraps from bloom back to trio. `FORM_HOLD_MS = 3600` and `MORPH_MS = 900`.
  - `BarsMascot({ mood?: MascotMood /* default "idle" */; form?: MascotForm /* fixed form; omit to run the morph loop */; size?: number /* px, default 120 */; once?: boolean /* play the mood once, then settle to idle; used for laughing */; label?: string /* aria-label; omit = aria-hidden */; className? })`
  - **Rendering:** one SVG with three bar groups whose geometry (x, y, width, height and rx through CSS transforms) transitions between forms in `MORPH_MS`. Hopper adds legs, Jelly turns on a goo filter plus drops, and Bloom widens the middle bar into the body and turns the outer bars into arms. Eyes stay attached to their bars, and only the Trio has eyes on all three bars.
  - **Reduced motion:** the Trio idle pose, still, with no loop.
- [ ] **Step 1: Write the tests** in `mascot.test.ts`:
  ```ts
  expect(MORPH_LOOP).toEqual(["trio","hopper","jelly","bloom"])
  expect(nextForm("trio")).toBe("hopper")
  expect(nextForm("bloom")).toBe("trio")
  ```
  Run them only with owner permission.
- [ ] **Step 2:** Implement `forms.ts` and `BarsMascot.tsx`. The loop timer is cleared on unmount, and `form` given means no loop.
- [ ] **Step 3:** Use it in these places:
  - PrepPanel: the morph loop, idle, size 140, replacing the Task 11 orb;
  - PrepFailed: oops;
  - ReportEvaluating: thinking, replacing the orb;
  - passed report: laughing with `once`;
  - EndedView: idle.
- [ ] **Step 4: Visual check.** Use a temporary preview route (`app/(app)/mascot-preview/page.tsx`, deleted afterwards) showing every form and mood, plus the loop, in both themes. Take several timed screenshots to catch mid-morph frames, which must have no broken geometry, detached eyes or limbs, or cut-off shapes. Leave changes in the working tree.
