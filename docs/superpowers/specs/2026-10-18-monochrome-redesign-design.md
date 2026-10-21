# Monochrome redesign: the whole web app, ElevenLabs / fish.audio style

**Date:** 2026-10-18 · **Status:** approved by the owner 2026-10-19 · **Scope:** `apps/web` only

Reference mockup (approved by the owner): [`2026-10-18-monochrome-redesign/home-dashboard-mockup.html`](2026-10-18-monochrome-redesign/home-dashboard-mockup.html). Open it in a browser. It has a light/dark toggle.

---

## 1. Intent

The owner wants InterviewIQ to look and feel like **ElevenLabs** (elevenlabs.io and its app) and **fish.audio**. In their words: "the richness, premiumness, simplistic but very polished, refined, premium." The bar is **simple premium**: few elements, each one finished.

The redesign covers every screen: landing and marketing pages, sign-in, onboarding, the signed-in app, the live interview room, the report and the admin pages. Page structure, layout, navigation, components and visual style may all change, and are expected to. **The user journey does not change:** sign up → onboarding → pick a company and role → see its process → start a track or book a round → prep → live interview → report → next round or retake. Every feature that works today keeps working.

This replaces the 2026-10-02 design language (Vercel base, mission-control HUD layer, orange accent; spec `2026-10-02-hud-redesign-design.md`).

## 2. Goals, non-goals, anti-goals

**Goals**
- One consistent design language on every page. The same tokens, type scale, primitives and motion everywhere.
- An ElevenLabs-style app shell: a left sidebar, a top bar, and a rich home dashboard with the features such dashboards usually have.
- Monochrome, in both a light and a dark theme.
- Polish: spacing rhythm, hairline depth, motion and empty, loading and error states all designed, not left at their defaults.

**Non-goals**
- No API, contract, backend or AI-service changes. No new endpoints. Any data a new design wants but the API does not provide is left out (see §9).
- No URL changes. Every route keeps its path, and redirects that exist today stay.
- No behaviour changes to gating, booking, proctoring, the live room machine, disputes, scoring display rules or validation.
- No copy rewrite beyond what the new layouts need. Existing copy rules still hold (§8).
- The admin (TPO) panel stays unbuilt. Its stubs are only re-skinned.

**Anti-goals** (the redesign fails if any of these happen, even if it "works")
- It looks like a template: generic shadcn defaults, a stock gradient hero, or emoji.
- Pages drift apart, so one screen looks like ElevenLabs and another still looks like the HUD.
- A feature disappears or a journey step gets harder: for example, booking takes more clicks, or the report hides a section.
- Colour creeps back in as decoration. The only exceptions are what §3.1 allows.
- It copies ElevenLabs or Fish branding: their logo, wordmark, the "ll" glyph, their product names or their imagery. We take the aesthetic, not the brand.

## 3. Design language

### 3.1 Colour

Warm monochrome. Light is the default and dark is a full peer. Tokens stay HSL CSS variables in `app/globals.css`, consumed through `tailwind.config.js`, keeping the existing semantic token names where they fit (`background`, `foreground`, `muted`, `border`, …) so shadcn primitives follow.

| Role | Light | Dark |
|---|---|---|
| Page background | `#ffffff` | `#0e0e0d` |
| Surface (tiles, table heads, carousel cards) | `#f7f7f6` | `#161615` |
| Surface 2 (active nav, hover, segment track) | `#f1f0ee` | `#1d1c1b` |
| Stone (featured blocks, secondary buttons, "Up next") | `#f5f2ef` | `#1b1a18` |
| Line (borders, dividers) | `#ebebea` | `#242422` |
| Ink (primary text, primary button) | `#0b0b0b` | `#f4f4f3` |
| Ink 2 (secondary text) | `#4e4e4e` | `#b4b2ae` |
| Ink 3 (muted text, icons, eyebrows) | `#8a8781` | `#7a7873` |

- **Primary button:** an ink fill with the background colour as text, so it is black on light and near-white on dark.
- **Secondary button:** a Stone fill with an inset ring.
- **Destructive:** the only hue allowed in UI chrome. It is a muted red, used only for destructive confirms and error text, never as decoration.
- **Charts and the heatmap:** a 5-step grey ramp from Line to Ink. Series are told apart by shade and pattern, not hue.
- **Orbs:** greyscale radial gradients standing in for ElevenLabs' coloured voice orbs. They are the signature decoration, used for avatars, the interviewer, track and result rows, and the "Up next" glow. Give each one a stable variant seeded from an id, so the same company or session always gets the same orb.
- **Grain:** an SVG noise overlay (about 15–22% opacity) on dark gradient surfaces only: the announcement strip, company art tiles, the auth side panel and marketing feature art.

The current orange `brand` token, the `cat-*` illustration tokens and the chart and heatmap palettes are all retired. The cat is removed (§5.6).

### 3.2 Type

- **Display and headings:** Inter Tight, weight 300 (display) or 400–500 (section and card titles), with tight tracking. Sizes: display 48/1.08 at −0.035em, page title 40/1.1, section 18/500, card title 22–28/400.
- **Body and UI:** Inter 400/500. 14px is the app base and 16–18px the marketing body. Use a very slight positive tracking.
- **Mono:** Geist Mono, kept for code, kbd hints and numeric IDs only. No more mono uppercase card headers.
- **Loading:** both families load through `next/font/google` (built into Next, so no new dependency). Geist Sans is removed and the `geist` package stays only for mono.

### 3.3 Shape, depth and spacing

- **Radii:** pills (9999px) for buttons, the search field, chips, segmented controls and inputs. 16px for tiles and table shells, 20px for cards, 24–30px for hero blocks and CTA panels. The owner kept rounder corners on 2026-10-02, and this scale keeps them.
- **Depth:** hairlines, not shadows. The standard elevation is `inset 0 0 0 .5px rgb(0 0 0 / .075)` plus `0 6px 16px rgb(78 50 23 / .04)` (a warm tint). In dark mode the ring is `rgb(255 255 255 / .07)` and the drop shadow is a darker black. Popovers and dialogs get one stronger float shadow. Nothing else casts a shadow.
- **Spacing:** an 8px base. App content has a max width of 1180px with 36px padding. Sections are 40–44px apart. Marketing sections use 96–128px vertical rhythm.
- **Removed:** the HUD layer is deleted outright: corner ticks, notches, dot grid, spotlight, `iq-hud`, `--hud-zoom` and the 90% zoom.
- **Kept:** hidden scrollbars (decided 2026-10-02).

### 3.4 Motion

CSS only, with no animation library (adding one is a stop-and-ask dependency). Use the existing `iq` easing `cubic-bezier(.2,.7,.2,1)`.
- Hover lift of 2–3px on tiles and cards.
- 150ms colour fades on nav, buttons and rows.
- Page content fades up 8px on mount.
- Skeletons use a soft shimmer.
- The theme switch keeps its View Transition.
- Orbs breathe slowly in the live room only, and react to voice activity there (§5.6).

Everything respects `prefers-reduced-motion`.

### 3.5 Primitives

New primitives replace `components/hud/*` and restyle `components/patterns/*`. Keep `components/ui` (shadcn) and re-theme it through tokens, plus small variant changes where the pill or ring style needs them. The set:

- `Button`: primary, secondary (stone), ghost, outline-pill, icon and destructive variants, at sizes sm, md and lg.
- `Card` and `Tile`: ring depth, with an optional hover lift.
- `Orb`: size plus a seed, with a `speaking` state for the live room.
- `Chip`, `StatusDot` (a monochrome dot: filled, hollow or pulsing) and `SegmentBar` (a readiness or progress segment bar).
- `PageHeader` (eyebrow, title, actions), `SectionHeader` (title, chevron link, actions) and `EmptyState` (orb, line, action).
- `DataTable`: a rounded shell with a grey header row and hairline rows.
- `Carousel`: horizontal scroll-snap with arrow buttons.
- `Kbd`, `Stat` (a big light number with a label) and `Meter`.

`HudEmpty`, `Readout`, `Count`/`padCount` and `SegmentMeter` map onto `EmptyState`, `Stat`, a plain number helper and `SegmentBar`. About 107 files import `components/hud` today. Every import is migrated, then the folder and its tests are deleted.

## 4. App shell (signed-in)

The approved mockup is the reference.

**Sidebar** (248px, full height, white or near-black, with a right hairline):
- **Logo:** an ink square mark with an audio-bar glyph, plus "InterviewIQ". Our own mark, not ElevenLabs' "ll".
- **Main:** Home (`/dashboard`), Companies (`/jobs`), Tracks (`/loops`), Interviews (`/interviews`), Practice (`/practice`).
- **"Build" group:** Processes (`/processes`), Share experience (`/experiences`).
- **"You" group:** Profile, Connections, Leaderboard.
- **"Admin" group** (admins only): Intelligence, Validation controls.
- **Bottom:**
  - a dismissible "Bring your college" invite card that links to `/for-colleges`;
  - Help;
  - an account row (orb, name, level) that opens the account menu;
  - the "Readiness" summary from today's menu ("N of M rounds completed"), shown as a small SegmentBar above the invite card.
- **Behaviour:**
  - The active item is a Surface 2 pill.
  - A topbar button collapses the sidebar to a 64px icon rail, and the choice is remembered in localStorage.
  - The `M` shortcut toggles it.
  - Below 1024px the sidebar becomes a sheet.

**Top bar** (60px, sticky, translucent blur):
- **Left:** a sidebar toggle and breadcrumbs. The breadcrumbs come from `titleForPath`, extended to give parent crumbs: Companies › Meesho › SDE I.
- **Centre:** a pill search, "Search companies, roles, interviews…" with ⌘K, which opens the existing CommandMenu, restyled.
- **Right:** Feedback (links to `/contact`), Help (`/help`), notifications (keeps its static "You're all caught up" popover) and the avatar orb, which opens the account menu.
- **Theme toggle:** moves into the account menu, which already has Light/Dark entries.

**Announcement strip** (40px, a grainy black gradient, white text, with a link and a dismiss button):
- Driven by a static config constant, not the API.
- Dismissal is stored in localStorage by announcement id.
- When there's no announcement, there's no strip.

**VerifyEmailBanner:** rendered as a slim stone bar under the top bar, keeping its "Resend link" behaviour.

The keyboard shortcuts (⌘K, M, Esc), their suspension in the live room and while typing, OnboardingGate and RequireAuth are all unchanged.

## 5. Pages

Each entry gives the new structure. Every control, state and data hook in today's page stays unless it is listed as dropped.

### 5.1 Home (`/dashboard`)

The page follows the approved mockup, from top to bottom:
1. **Header.** A date eyebrow and "Good evening, {name}". The right side has the secondary "Explore companies" and the primary action. The primary keeps today's logic: the next session, else a ready loop, else "Schedule a round" linking to `/interviews`.
2. **Quick-start tiles**, six of them: Schedule round (`/interviews`), Find a role (`/jobs`), Start a track (`/loops`), Connect sources (`/connections`), Practice (`/practice`) and Share experience (`/experiences`). A tile's subtitle shows a live count only where an existing hook already provides it, for example the number of roles from `useJds`; otherwise it shows static copy.
3. **Two columns.**
   - **"Up next" (a stone card):** today's UpNextCard data, shown as a round chip, the title, the slot, the length and the interviewer orb. The actions are Open briefing (`/interviews/[id]`) and Reschedule. With no session, it shows an empty state with "Schedule a round".
   - **"Readiness":** today's ReadinessCard data, with each track shown as a row with a logo square, its rounds passed and a SegmentBar. The level label beside each row uses mock-readiness wording, and the note "Counts unedited processes only" stays.
4. **Calendar.** A compact month card (today's CalendarCard: prev/next, today, select a day, that day's sessions with join) sits beside a "This week" agenda list.
5. **Recent results.** A DataTable of the last sessions with these columns: round, track, date, score /10 (the session payload carries `score`, `outcome`, `passMark`, `retakeAfter`), outcome chip (Passed, Below pass with the retake date, or Not scored) and a row link to the report. It keeps today's skeleton, error and empty states.
6. **Companies carousel ("Researched processes").** The data is `useJobCompanies` filtered to live companies, in the order the API returns them. Each card has grainy grey art with the company name, the role count and an arrow, and links to `/jobs/c/[slug]`. It is not called "Popular", because we have no popularity data.

**Dropped:** the "coming soon" score and rank tiles and the "Leaderboards aren't live yet" card. They show no data, and the leaderboard is reachable from the sidebar.

### 5.2 Companies, roles and role detail

- **Companies (`/jobs`):**
  - **Header:** the PageHeader "Companies".
  - **Toolbar:** a big pill search, with a segmented All / Live / Researching control beside it.
  - **Grid:** a responsive 3–4 column grid of company cards, styled like ElevenLabs' voice-library rows: a logo square or orb, the name, a status chip and the role count, with "View roles" and the primary JD CTA on hover or focus. The fish.audio card-grid density is acceptable here.
  - **States:** all of today's states.
- **Company roles (`/jobs/c/[slug]`):**
  - **Header:** breadcrumbs plus a company header with a large art tile and the HQ, size and role-count meta.
  - **Toolbar:** a sticky filter bar with search, sort, level chips as pill toggles and "More filters" opening an inline panel. Every filter stays in the URL.
  - **Results:** role cards in level groups.
  - **MatchPill:** a monochrome chip, with an outline for a stretch role.
- **Role detail (`/jobs/[jobId]`):**
  - **Hero:** the title, the meta line, a match chip, the readiness state and the primary actions (Open/Start track, Duplicate & customise, Add to targets).
  - **Tabs:** underline tabs as in the ElevenLabs Explore page: Process, Insights, Your match.
  - **Process tab:** the flow on a dotted-paper canvas with monochrome nodes, then round cards with tiles, topics, disclosures and "Book this round".
  - **Insights tab:** a clean two-column reading layout.
  - **Your match tab:** the big % as a Stat, then five Meter rows with evidence chips.
  - **About and Role details:** moved into a right sidebar column on wide screens.

### 5.3 Tracks and processes

- **Tracks (`/loops`):**
  - **Stats:** a row of 4 Stat tiles.
  - **Tabs:** Tracks / Schedule / Targets, still `?tab=`.
  - **Track cards:** wide rows with an orb, the JD title, a SegmentBar, the next-round CTA and an overflow menu (Pause/Resume, Abandon).
  - **Schedule:** a DataTable.
  - **Dialogs:** Book, Reschedule and Cancel are restyled, and SlotPicker uses pill day and hour chips.
- **Loop dashboard (`/loops/[loopId]`):**
  - **Header:** breadcrumbs plus the title, status chips and actions.
  - **Progress:** "X of Y rounds" with a large SegmentBar and the readiness line in mock-readiness wording.
  - **Flow:** a full-width card with the read-only canvas. Each node shows its state as a monochrome node style (done = ink fill, ready = ink ring, locked = dashed line, cooldown = hollow plus date).
  - **Interviews:** a DataTable.
- **Processes (`/processes`):** a grid of process cards with an overflow menu; Create dialog restyled.
- **Process editor (`/processes/[processId]`):**
  - Keeps its full-screen three-pane layout: palette, canvas and inspector.
  - The panes become floating rounded panels over a dotted canvas, in the style of a modern node editor.
  - Header actions are pills.

### 5.4 Interviews and session detail

- **Interviews (`/interviews`):**
  - **Layout:** two columns. On the left a "Book a round" composer in a stone card, styled like fish.audio's generate widget. It has the role select, round chips, a Start now / Schedule toggle, day chips, the calendar popover, hour chips, and one primary CTA. On the right, "Upcoming" and "Past" lists.
  - **Status actions:** each session row's action follows its status: Join, Rejoin, Retry, Debrief, or a disabled Ready.
  - **Kept:** prefill from `?jd` and `?round`.
- **Session detail (`/interviews/[sessionId]`):**
  - **Hero:** the round title, a status chip and the primary SessionAction.
  - **Body:** the BriefingCard as the interviewer's profile, with a large orb, name, style, format, duration and pass mark. Below it, Details and a vertical progress timeline.
  - **States:** the prep and prep-failed states as below.

### 5.5 Live room (`/interviews/[sessionId]/live`)

The state machine, proctoring, fullscreen gates, guards and shortcuts are unchanged. Only the presentation changes:
- **Prejoin and checks:** centred cards on a plain background. Checks appear as a list with a monochrome pass/fail StatusDot and a short line each.
- **Live view:**
  - **Header:** slim. Round eyebrow, a live StatusDot, the proctor counters as small chips and the elapsed clock.
  - **Stage:** the interviewer is a large `Orb` that breathes when idle and pulses while the interviewer speaks. It is driven by the agent state `LiveKitLiveSession.ts` already exposes: initializing, listening, thinking, speaking. Each state gets its own orb motion. The transcript bubbles become a clean caption column. The camera self-view is a small rounded tile.
  - **Work area:** a tool rail of icon pills for Problem / Code / Whiteboard. The panels are rounded cards. Monaco uses custom monochrome light and dark themes, and Excalidraw follows the app theme.
  - **Bottom bar:** a floating centred pill containing the mic toggle and "End interview". It uses the destructive style only inside the confirm dialog.
  - **Proctor bars:** slim ink banners with their countdowns.
- **Ended view:** a centred card.

### 5.6 Prep state and the mascot

PrepPanel keeps its five steps and their timings. **The orange cat is removed (owner, 2026-10-19).** Delete `prep-animation/` (the cat and its scenes) and the `cat-*` tokens.

**The mascot is "the bars" (owner, 2026-10-19).** The logo's three audio bars come alive. The reference is `.superpowers/brainstorm/87486-1792346878/content/mascot-bars-v2.html`.

- **Base form:** the **Trio**. Three bar siblings, each with its own eyes, bouncing in a staggered wave, blinking out of sync and glancing at each other.
- **Morphing:** between sequences it **morphs through the other three forms** and back, in this loop: Trio → Hopper (grows legs and hops across) → Jelly (gooey and wobbling, drops bubbling off) → Bloom (merges into one body with arm bars, waves and hums) → splits back into the Trio. Each hold lasts a few seconds, and each transition is a smooth shape morph, never a cut.
- **Moods,** from the mood sheet, available on any form:
  - idle (breathing equalizer, blinking);
  - listening (leaning in, eyes up);
  - thinking (the bars collapse into three bouncing dots);
  - laughing (jumping, arms up, squinted eyes and a grin);
  - oops (tumbles, sees a star, gets up with a crossed bandage);
  - speaking (fast equalizer with a moving mouth).
- **Look:** monochrome. Bars are ink, and eyes and mouth are the page colour. It works in both themes and respects reduced motion with a still pose.
- **Where it appears:**
  - **Prep screen:** the morph loop in idle mood, above the step list.
  - **Prep failed:** oops.
  - **Report evaluating:** thinking.
  - **Report passed:** laughing, played once on arrival.
  - **The live room's ended view:** idle.
  - **Live room stage:** the interviewer stays the `Orb` (§5.5), and the mascot does not replace it.

The user's standing direction for mascots applies: it never sits in one static pose, it changes expressions, it stays cute, and its limbs look natural.

### 5.7 Report (`/interviews/[sessionId]/report`)

- **Layout:** two columns.
  - **Left:** a sticky rail containing:
    - the score as a large light display number "7.4 / 10";
    - a pass-mark tick on a thin meter;
    - the outcome chip and verdict;
    - the gating CTA, with the same rules: Book next round, Retake from {date} (disabled until then), or Retake now;
    - the section nav as a vertical list with an active marker.
  - **Right:** Overview (summary, strengths, sub-score Stats), Score build-up (Meter rows plus the adjustments ledger), Questions (expandable cards with code traces and board previews), Work on, Delivery, Conduct, then Transcript (caption-style with filter chips and moment anchors).
- **Disputes:** "Question this score" is a ghost pill. The dialog is restyled, and the limits and statuses are unchanged.
- **States:** all of them stay: evaluating, failed, legacy, unscorable and ready. "Evaluating" uses a breathing orb.

### 5.8 Profile, connections and the rest

- **Profile:**
  - **Header:** a large orb avatar, name, headline and level chip, with the Profile score as a Stat and its BETA chip.
  - **Body:** two columns of hairline cards. Every section stays editable as today.
  - **SourceActivity:** today it is built but unused, and it stays unused (no feature additions).
- **Connections:** a list of provider rows styled like ElevenLabs integration rows. Each row has a logo square, name, status chip and action pill. The LinkedIn and resume dialogs are restyled, and "How sources are used" moves to a side card.
- **Experiences:** the form in a centred card, with the guide as a side panel.
- **Leaderboard:**
  - **Header:** a level segmented control and the opt-in status line.
  - **Body:** a DataTable showing rank, an orb with the profile name, the score and the percentile. The BETA wording is kept.
- **Help:** an FAQ accordion with plus icons, a shortcuts card using Kbd, and a contact link.
- **Practice:** stays a stub, but a designed "Coming soon" EmptyState (orb, one line, link to Companies) replaces StubScreen everywhere.
- **Settings:**
  - **Layout:** a left sub-nav inside the page, like ElevenLabs settings.
  - **Account, Notifications, Privacy, Billing:** rows of label, description and control, grouped into cards. All controls are kept.
  - **Delete account:** a destructive card at the bottom.
- **Intelligence (admin):** restyled through the primitives and tokens only. Tabs become underline tabs, and tables, timelines, trace trees and log terminals take the new tokens. No structural redesign, because it is an internal console. The log terminal may stay dark in both themes.
- **Admin group:** the stubs use the new EmptyState, and the Validation controls panel is restyled. It must not import the student app shell (existing rule).

### 5.9 Auth (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/auth/callback`)

- **Split layout** for login and sign-up:
  - **Left column** (max 400px, centred vertically): the logo, the heading in display type, Google first as a full-width outline pill, an "or" hairline divider, pill inputs and a primary pill submit.
  - **Right panel:** full-height and rounded, a black grainy gradient with a large slowly drifting orb and one rotating sample line (today's RoundsPanel content, simplified). It is hidden below 1024px.
- **Single-column flows** (forgot, reset, verify, callback): a centred card.
- **Header and footer:** the shell keeps the logo plus "Back to site". The theme toggle goes in the footer corner.
- **Unchanged:** all fields, validation messages, query parameters, errors and redirects.

### 5.10 Onboarding (`/onboarding`)

- **Layout:** full screen with no sidebar. A slim top bar holds the logo, a 4-segment progress bar (Resume · Profile · Sources · Target) with step names, the draft status and Sign out.
- **Content:** each step is a centred column (max 640px) with a display-type question as its title. Examples: "Start with your resume", "Check your profile", "Connect your work", "Where are you headed?" (the last is a new title for the Target step).
- **Live preview:** ProfilePreview becomes a floating card on the right at ≥1280px and an expandable "Preview" drawer below that.
- **Step footer:** a sticky bottom bar with Back, Skip for now where allowed today, and the primary pill.
- **Upload:** the resume drop zone is a large dashed rounded area with an orb that breathes while parsing.
- **Target picker:** a search plus company rows and role chips.
- **Unchanged:** all fields, required rules, step memory, drafts and toasts.

### 5.11 Marketing (`/`, `/about`, `/contact`, `/for-colleges`, `/pricing`)

- **Header:** an ElevenLabs-style transparent sticky header that gets a hairline on scroll. It has the logo, the existing anchor links, "Log in" as a ghost button and "Start free" as an ink pill. The mobile sheet keeps the same items.
- **Home:** the landing page is restructured in the ElevenLabs and fish.audio manner, keeping all of today's content, CTAs and anchors (`#product`, `#interview`, `#debrief`, `#how`, `#readiness`, `#universities`):
  1. **Hero.** A centred light display headline (today's), a subline, and the email + "Start for free" pill form with Google beside it. Under it sits a **product demo widget** in the fish.audio manner: a stone card where the visitor picks a sample company chip and sees a sample question appear with an orb "speaking" animation, with signal chips under it. It uses today's InterviewDemo content and is static with scripted animation. It plays no audio and makes no API calls.
  2. **Company wordmark strip:** greyscale and slowly scrolling.
  3. **Three feature sections** (research, interview, debrief). Each has alternating copy and a panel card with today's sample data, restyled to the new tokens with grain art.
  4. **How it works:** three cards.
  5. **Readiness timeline:** keeps its horizontal scroll.
  6. **Why cards:** a bento grid.
  7. **Universities:** a stone CTA panel with the accordion.
  8. **Personas:** a carousel.
  9. **Closing CTA:** a black grainy panel with an orb.
  10. **FAQ.**
  11. **Footer:** multi-column on the page background.
- **About, Contact, For colleges, Pricing:** the same tokens and section patterns, with content unchanged.
- **LandingMotion:** keeps its reveal and count behaviour and drops the "scramble" effect, which reads as HUD.

## 6. Constraints

- **Stack:** Next.js 16 App Router, React 19, Tailwind 3.x (not 4), the shadcn classic set, TanStack Query.
  - Server Components by default.
  - Read `node_modules/next/dist/docs/` before Next-specific code (`apps/web/AGENTS.md`).
- **No new runtime dependencies.** Fonts come through `next/font/google`. Anything else, an animation library for instance, means stop and ask the owner.
- **Untouched:** URLs, API calls, hooks, query keys, generated types and every behaviour rule.
- **Accessibility:** WCAG AA contrast on both themes. Ink 3 on white must be checked; darken it if it fails for body-size text. Every control gets a visible focus ring (a 2px ink ring with offset). Reduced motion is honoured. Existing aria labels are kept.
- **Responsive:** must work at 1440, 1280, 1024, 768 and 390px. The live room and process editor stay desktop-first as today.
- **Route-group independence:** `(admin)` must not share the student shell.
- **Working tree:**
  - Work stays uncommitted for the owner to commit (owner preference).
  - Another agent may edit this repo at the same time. Check file mtimes before overwriting.
- **Verification:**
  - Done visually, by running the app and checking each page in both themes at the breakpoints above.
  - The owner runs test suites only when asked. Do not run vitest, tsc or eslint unprompted.
  - Tests that the migration breaks are updated as part of the same task. Example: `components/hud/*.test.tsx` is deleted with the folder.
- **Docs:** update `CLAUDE.md`'s frontend line and the memory pointer once it ships. The `InterviewIQ Landing Page/` Claude Design export is no longer the UI reference.

## 7. Phasing (suggested order for the plan)

1. **Foundation.** Tokens (both themes), fonts, radii and depth utilities, primitives, the shadcn re-theme, the Monaco theme and the chart and heatmap ramps.
2. **Shell.** Sidebar, top bar, announcement strip, account menu and CommandMenu.
3. **Home.**
4. **Companies, roles and role detail.**
5. **Tracks, loop dashboard, processes and process editor.**
6. **Interviews, session detail, prep and live room.**
7. **Report.**
8. **Profile, connections, experiences, leaderboard, help, practice and settings.**
9. **Auth and onboarding.**
10. **Marketing.**
11. **Intelligence and admin restyle.** Then delete `components/hud`, the HUD CSS, the `hud:` Tailwind variant, `--hud-zoom`, the retired tokens and dead components.

Each phase must leave the app consistent. Until phase 11, pages not yet migrated still render, through re-themed tokens. Phase 1 keeps the HUD classes, `--hud-zoom` and the `brand` token alive, but points `brand` at ink so no orange shows. Phase 11 removes them.

## 8. Copy rules that still apply

- Write "resume", never "résumé".
- Readiness is "mock-interview readiness", never a badge, certificate or company endorsement. Write "Interview-ready · Meesho SDE I mock process".
- The descriptive profile summary carries no scores. Profile score and interview score stay visually separate, and the profile score keeps its BETA label.
- The interviewer's minutes and questions are never shown before the round. The briefing shows only the interviewer, format, duration and pass mark.

## 9. Left to the builder

- Exact icon choices (lucide, stroke 1.6–1.8) and illustration details within this language.
- The layout of every page other than Home, within the language and structure this document gives. Only Home has a mockup.
- Exact skeleton shapes, and the precise breakpoint behaviour of each grid.
- Orb seeding and gradient variants.
- Where existing data allows a richer display (for example, live counts on tiles), using it. Where it does not, leave the element out rather than invent data.
- Whether to also read LiveKit audio levels for a finer orb pulse. The agent state alone is enough.

## 10. Calls made by the designer, not the owner

These are the designer's calls. The owner can overrule any of them.
- Light is the default theme and dark is a full peer, as today.
- The fonts are Inter Tight plus Inter. ElevenLabs' Waldenburg is proprietary.
- Sidebar grouping and item names: "Tracks" for My tracks, a "Build" group, and an "Admin" group.
- The "coming soon" score tiles and the leaderboard placeholder are dropped from Home.
- The company carousel is "Researched processes", not "Popular", because there is no popularity data.
- The announcement strip is driven by a static config.
- Feedback links to `/contact`, and the theme toggle moves into the account menu.
- Intelligence is restyled only, not restructured.
- The landing "scramble" animation is dropped.
