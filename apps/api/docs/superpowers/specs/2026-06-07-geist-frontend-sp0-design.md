# Geist Frontend Revamp — SP-0: Foundation kit + live-surface redesign (Design)

**Date:** 2026-06-07
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Repo:** `interviewiq-frontend` (Next.js 16 / React 19 / Tailwind 3.4 / shadcn / Geist)

---

## 0. Context — this is SP-0 of a decomposition

The user asked to revamp the **entire** frontend in the Geist Design System (all ~40 routes, full redesign). That is the whole product UI and far too large for one spec, and most routes are stubs for features whose backends don't exist. So it was **decomposed** into sub-projects, each its own design→plan→build cycle:

- **SP-0 (this spec)** — Geist Foundation kit + redesign the **live** surfaces.
- SP-1 Marketing site · SP-2 Auth pages · SP-3 App core · SP-4 Interview modules · SP-5 Admin panel — later, one at a time.

Geist is already adopted (fonts + neutral tokens + shadcn, baseColor `neutral`). SP-0 builds the reusable design layer on top and re-crafts the surfaces that actually exist.

**Accent decision (locked):** **pure monochrome** — neutral grays + near-black/white only, **no blue**; charts grayscale; status green/red used only as sparse semantic dots.

---

## 1. Design language (codified)

- **Color:** only the neutral token scale (`background`, `foreground`, `muted`, `border`, `primary` = near-black/white, etc.). No accent hue. Charts use grayscale ramps (`--chart-1..5` already neutralized). Semantic color limited to: connected = green dot, error/destructive = red, in-progress = amber — as small dots/badges only, never fills.
- **Type:** Geist Sans for UI; **Geist Mono for ALL numerals, IDs, code, and data badges** (e.g. `read:user`, `1,204`, hashes, percentages). Scale: page title ~28/600/-0.02em; uppercase mono section label ~11/letter-spacing .06em/muted; body ~14; caption ~12/muted.
- **Surface & shape:** base `hsl(var(--background))` (`#0a0a0a` dark); panels = `bg-card` + `1px` `border-border` hairline; radii — cards `rounded-xl` (~12px), controls `rounded-md`/`lg` (~8px). Generous, consistent spacing; denser in-app, more spacious on marketing.
- **Motion:** fast, subtle — opacity/`translateY` fades, hover/focus/press micro-interactions, skeleton loaders. No bounce/playful motion. Use `tailwindcss-animate` + small CSS transitions.
- **A11y:** semantic landmarks (one `<main>`), `aria-current` on active nav, ARIA on status badges, visible focus rings (neutral), labelled controls.

---

## 2. Foundation kit

New composition components under **`components/patterns/`** (route-agnostic), plus shell refinements. Each reuses installed shadcn primitives — no new heavy abstraction.

| Component | Interface | Purpose |
|---|---|---|
| `PageHeader` | `{ title, description?, actions?: ReactNode }` | Consistent page top: title + optional description + right-aligned actions slot. |
| `Section` / `SectionLabel` | `Section{ title?, children }`, `SectionLabel{ children }` | Uppercase mono label + content block with hairline separation. |
| `StatTile` / `StatRow` | `StatTile{ value, label, mono? }`; `StatRow` lays out 2-4 tiles | KPI numerals in Geist Mono; hairline-divided row. |
| `EmptyState` | `{ icon?, title, hint?, action?: ReactNode }` | Not-connected / no-data states. |
| `FormField` | `{ label, hint?, error?, children }` | Label + control + hint/error; pairs with react-hook-form + zod. |
| `Skeletons` | per-surface skeleton compositions | Loading states (profile, connections, dashboard). |
| `DataTablePattern` | thin wrapper over shadcn `table` | For later list/admin surfaces (built now, used later). |

**Shells (refine, don't rebuild logic):**
- **Marketing** — sticky hairline header (brand + nav + Sign in) + minimal footer.
- **Auth** — centered card shell (max-w-sm, hairline card, brand mark).
- **App** — polish the existing `app-sidebar` / `site-header` / `SidebarInset` (active-state = subtle inset ring, `nav-user`, header title/actions). Keep `RequireAuth` wrapping intact.

**Primitives to add if missing** (classic CLI `shadcn@2.10.0 add`): `table`, `input`, `label`, `form`, `scroll-area`. Existing: card, button, badge, dialog, dropdown-menu, avatar, separator, sheet, tooltip, sidebar, chart, sonner, skeleton, tabs.

---

## 3. Live-surface redesigns (on the kit)

All keep current data wiring/logic; only layout/visual structure changes.

- **Marketing home** (`(marketing)/page.tsx` + layout) — editorial monochrome hero: mono eyebrow, large tight headline, muted subhead, primary CTA → `/login` + secondary → pricing; subtle dot/grid background; value-prop row; minimal footer. Header via the marketing shell.
- **Login** (`(auth)/login`) + **auth callback** (`app/auth/callback`) — centered Geist card, brand mark, monochrome Google button, terms caption; callback = refined centered spinner + status copy.
- **App shell** (`(app)/layout.tsx` + `app-sidebar`/`site-header`/`nav-*`) — brand header, nav with mono-tinged active inset, `nav-user` (name from `useProfile`, logout), collapsible; header shows current page + actions slot.
- **Dashboard** (`(app)/dashboard`) — replace placeholder with a clean Geist "welcome / next steps" page: greeting, a `StatRow` (sources connected etc. from `useProfile`), and connect/complete-profile CTAs. No invented metrics.
- **Profile** (`(app)/profile` + `_components/AtAGlance` + `components/visualizations/*`) — re-craft Layout A with `PageHeader`, `StatTile`s (mono), grayscale `LanguageDistribution`/LeetCode charts, custom contribution heatmap (grayscale intensity), hairline `Section` dividers, polished source cards, "Manage connections" link. Keep no-scoring rule.
- **Connections** (`(app)/connections` + `_components/*`) — polished `ProviderCard` state machine (not-connected / connected + last-refreshed / error), `ConnectionButton` (apiFetch→navigate, pending state), `DisconnectDialog`, `EmptyState` usage, `?error=` surfacing.

---

## 4. File structure

| Path | Action |
|---|---|
| `components/patterns/{PageHeader,Section,StatTile,EmptyState,FormField,Skeletons,DataTablePattern}.tsx` | Create |
| `components/patterns/index.ts` | Create (barrel) |
| `app/globals.css`, `tailwind.config.js` | Tweak only if a token/utility gap appears (no palette change) |
| `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx` | Redesign |
| `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/auth/callback/page.tsx` | Redesign |
| `app/(app)/layout.tsx`, `components/app-sidebar.tsx`, `components/site-header.tsx`, `components/nav-*.tsx` | Polish |
| `app/(app)/dashboard/page.tsx` | Redesign (welcome/next-steps) |
| `app/(app)/profile/page.tsx`, `app/(app)/profile/_components/AtAGlance.tsx`, `components/visualizations/*` | Re-craft |
| `app/(app)/connections/page.tsx`, `app/(app)/connections/_components/*` | Polish |
| `*.test.tsx` (existing) | Keep green; update selectors only if markup changes break them |

---

## 5. Constraints & non-goals

- **Layout/visual only** — do not change data fetching, auth, routing, or the `ProfileResponse` contract. No backend changes.
- **No scoring/ranking** anywhere (CLAUDE.md hard rule) — descriptive only.
- **Keep existing tests green**; add render tests for new `patterns/` pieces that contain logic (e.g. `EmptyState` action, `FormField` error). Verify `npm run build` + `npm run test` after each task.
- **Out of scope:** SP-1…SP-5 (marketing build-out, auth extras, other app modules, admin); any new route content beyond the live surfaces + the dashboard welcome page.

---

## 6. Testing approach

- `npm run build` is the integration gate (Tailwind + TS).
- `npm run test` (Vitest + RTL) stays green; add tests for `patterns/` components with behavior.
- Manual visual check via dev server on the redesigned surfaces (dark + light).
- No-scoring audit grep over profile/connections/visualizations remains clean.
