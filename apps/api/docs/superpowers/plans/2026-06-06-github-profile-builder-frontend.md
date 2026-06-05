# Profile Builder — Frontend Slice (App Shell, Connections, Profile, Charts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt shadcn/ui, build the authenticated app shell (cherry-picked from the `dashboard-01` block), a dedicated `/connections` hub that drives the GitHub OAuth connect/disconnect flow, and a dark, read-only `/profile` page that renders the consolidated `ProfileResponse` with shadcn/Recharts visualizations and a custom contribution heatmap — all with no scoring/ranking labels anywhere.

**Architecture:** Next.js 16 App Router (React 19, TypeScript, Tailwind 3.4). Auth is backend-owned (Google OAuth → httpOnly refresh cookie → in-memory access token via `AuthProvider`); all backend calls go through `apiFetch` (Bearer + single silent 401 refresh). The new GitHub connection is a *second* OAuth flow initiated by navigating the browser to `{NEXT_PUBLIC_API_URL}/api/v1/connections/github/authorize`; the backend redirects back to `/connections`. Both `/profile` and `/connections` read the same `GET /api/v1/profile/me` endpoint via a shared TanStack Query hook; only `/connections` mutates (DELETE disconnect). The shell preserves client-side auth gating by wrapping the `SidebarProvider` tree in the existing `RequireAuth`.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind CSS 3.4 (HSL CSS-variable tokens, `darkMode: ["class"]`), shadcn/ui (`new-york` style, `slate` base, cssVariables), Recharts (via shadcn `chart`), `sonner` toasts, `lucide-react`, TanStack Query v5, Playwright (the only test runner installed).

---

## Critical context discovered (read before starting)

- **No unit-test runner is installed.** `node_modules/.bin` has no `vitest`/`jest`; only `@playwright/test`. This plan adds **Vitest + React Testing Library** in Task 0 so component-level tests (charts, `useProfile` states, ConnectionButton navigation) can be TDD'd, plus Playwright for the happy-path. Do not invent a `jest` config.
- **`apiFetch`** (`lib/api-client/client.ts`) takes a path *relative to* `NEXT_PUBLIC_API_URL` and prefixes `BASE_URL`. The existing `profileApi.me()` calls `apiFetch("/profile/me")` — but the spec endpoint is `/api/v1/profile/me`. The real path is **`/api/v1/profile/me`**; the existing stub is wrong. This plan uses the full `/api/v1/...` path.
- **`apiFetch` returns parsed JSON or `undefined` for 204.** DELETE disconnect returns 204 → `apiFetch<void>` resolves `undefined`. Good for `useMutation`.
- **Auth:** `useAuth()` exposes `{ status, isAuthenticated, isLoading, login, logout }`. There is **no user object** in the auth context (no name/email). `nav-user` must therefore source the display name/avatar from `GET /api/v1/profile/me` (`profile.user.name`), with a generic fallback, and call `logout()` from `useAuth`. Do NOT invent a `useUser` that returns auth identity — `lib/hooks/useUser.ts` exists but is out of scope; bind nav-user to `useProfile` + `useAuth().logout`.
- **`window.location` navigation to the backend authorize URL** is the connect mechanism (matches `loginWithGoogle()` in `lib/auth/client.ts` which sets `window.location.href`). Use `APP_CONFIG.apiUrl` (= `NEXT_PUBLIC_API_URL`), exactly like `lib/auth/client.ts` does.
- **Tailwind-3 vs dashboard-01 (v4) tokens — the biggest integration risk.** The `dashboard-01` block + shadcn sidebar ship v4/oklch `--sidebar-*` tokens. This repo is Tailwind 3.4 with HSL tokens. After `shadcn init`/add, the `--sidebar-*` vars MUST be hand-added as HSL into the existing `:root`/`.dark` blocks in `app/globals.css` AND mirrored under `theme.extend.colors.sidebar.*` in `tailwind.config.js`, or the sidebar renders colorless. A verification `npm run build` gates this.
- **`lucide-react@^1.16.0` — VERIFIED, not a bug.** I confirmed `npm view lucide-react dist-tags` → `latest: 1.17.0`, and the installed `1.16.0` genuinely exports `LayoutDashboard`, `UserCircle`, `Link2` (all resolve). lucide-react really does ship a `1.x` line. **Flag for the engineer:** shadcn docs historically reference `0.x`; if a future `shadcn add` pins/downgrades lucide or an icon import 404s at build, re-pin to the latest `1.x` (`npm i lucide-react@latest --legacy-peer-deps`) rather than `0.x`. Verify with `npm run build` after any shadcn add.
- **React 19 peer deps:** install shadcn/deps with `--legacy-peer-deps` (NOT `--force`); verify `package-lock.json` after.
- **Existing stubs to convert to redirects:** `app/(app)/profile/connections/page.tsx` and `app/(app)/onboarding/connections/page.tsx` (both are one-line placeholder pages today). Task 7 Steps 3–4 overwrite each with a `redirect(ROUTES.connections)` server component so both legacy paths funnel into the single `/connections` hub.
- **`components/visualizations/.gitkeep` and `features/profile/{api,hooks,types}/.gitkeep`** already exist — add real files alongside / replacing the gitkeeps.

---

## File Structure

| Path | Responsibility |
|---|---|
| `components.json` | shadcn config (new-york, slate, cssVariables, alias `@/`, lucide). Created by `shadcn init`. |
| `components/ui/*.tsx` | shadcn primitives: `card`, `button`, `dialog`, `badge`, `dropdown-menu`, `avatar`, `separator`, `sheet`, `tooltip`, `sidebar`, `chart`, `sonner`, `skeleton`, `tabs`. Generated, not hand-written. |
| `app/globals.css` | MODIFY — back-port `--sidebar-*` (and chart) HSL tokens into existing `:root`/`.dark`. |
| `tailwind.config.js` | MODIFY — mirror `sidebar.*` / `chart.*` colors + keyframes/animation shadcn needs. |
| `app/layout.tsx` | MODIFY — mount `<Toaster />` (sonner) once at the root. |
| `lib/constants/routes.ts` | MODIFY — add `connections: "/connections"`. |
| `components/app-sidebar.tsx` | App shell sidebar: brand header + `NavMain` (Dashboard/Profile/Connections) + `NavSecondary` (Help) + `NavUser`. |
| `components/nav-main.tsx` | Renders primary nav items, active-route highlight. |
| `components/nav-secondary.tsx` | Renders secondary nav (Help/Feedback). |
| `components/nav-user.tsx` | Footer user menu; name/avatar from `useProfile`, Logout via `useAuth().logout`. |
| `components/site-header.tsx` | Sticky header: sidebar trigger + current-page title. |
| `app/(app)/layout.tsx` | MODIFY — `RequireAuth` → `SidebarProvider` + `AppSidebar` + `SidebarInset` + `SiteHeader` + `{children}`. |
| `app/(app)/dashboard/page.tsx` | MODIFY — placeholder dashboard (so sidebar nav isn't broken). |
| `features/profile/types/profile.ts` | EXACT mirror of `ProfileResponse` (spec §6) + GitHub fragment shape (§4). |
| `features/profile/api/getMyProfile.ts` | `getMyProfile()` → `apiFetch<ProfileResponse>("/api/v1/profile/me")`. |
| `features/profile/api/disconnectGithub.ts` | `disconnectGithub()` → `apiFetch<void>("/api/v1/connections/github", { method: "DELETE" })`. |
| `features/profile/hooks/useProfile.ts` | TanStack `useQuery(["profile","me"])`. |
| `features/profile/hooks/useDisconnectGithub.ts` | TanStack `useMutation` → invalidate `["profile","me"]`. |
| `features/profile/index.ts` | MODIFY — barrel re-exports. |
| `components/visualizations/LanguageDistribution.tsx` | shadcn chart + Recharts `PieChart` of GitHub languages. |
| `components/visualizations/LeetCodeDifficulty.tsx` | Recharts pie (Easy/Med/Hard); data-driven, empty-safe. |
| `components/visualizations/LeetCodeTopics.tsx` | Recharts bar of topic solve counts; data-driven, empty-safe. |
| `components/visualizations/ContributionHeatmap.tsx` | CUSTOM 52×7 Tailwind grid, intensity bins. |
| `components/visualizations/GithubStatTiles.tsx` | CUSTOM shadcn `Card` tiles with mono numerals. |
| `app/(app)/profile/page.tsx` | MODIFY — Layout A read-only consolidated view + "Manage connections" link. |
| `app/(app)/profile/_components/AtAGlance.tsx` | Renders `atAGlance` + `notable` + `mostUsedSkills` bands (no scores). |
| `app/(app)/connections/page.tsx` | NEW — connections hub; reads `?error=`; renders `ConnectionsGrid`. |
| `app/(app)/connections/_components/ConnectionsGrid.tsx` | Responsive grid of `ProviderCard`s from `profile.sources`. |
| `app/(app)/connections/_components/ProviderCard.tsx` | Per-source state machine card (cva variants). |
| `app/(app)/connections/_components/ConnectionButton.tsx` | `window.location` → authorize endpoint. |
| `app/(app)/connections/_components/DisconnectDialog.tsx` | Confirm modal → `useDisconnectGithub`. |
| `app/(app)/connections/_components/ConnectionStatus.tsx` | ARIA status badge. |
| `app/(app)/connections/_components/SourceIcon.tsx` | Per-provider lucide icon. |
| `app/(app)/connections/_components/providers.ts` | Static provider registry (label/description/icon/live flag). |
| `app/(app)/profile/connections/page.tsx` | MODIFY — redirect to `/connections`. |
| `app/(app)/onboarding/connections/page.tsx` | MODIFY — redirect to `/connections`. |
| `vitest.config.ts` | NEW — Vitest + jsdom + `@/` alias. |
| `vitest.setup.ts` | NEW — `@testing-library/jest-dom` + ResizeObserver/matchMedia polyfills (Recharts/sidebar need them). |
| `features/profile/hooks/useProfile.test.tsx` | RTL test: connected vs placeholder render. |
| `components/app-sidebar.test.tsx` | RTL test: three nav links + hrefs; NavUser bound to profile name (spec §9). |
| `components/visualizations/LanguageDistribution.test.tsx` | renders from fragment data, asserts no ranking text. |
| `app/(app)/connections/_components/ConnectionButton.test.tsx` | asserts navigation to authorize endpoint. |
| `app/(app)/connections/_components/DisconnectDialog.test.tsx` | RTL test: confirm fires disconnect mutation + success path / dialog close (spec §9). |
| `tests/connections.spec.ts` | NEW Playwright — sidebar nav → /connections → Connect navigates to authorize. |

---

## Task 0: Test tooling (Vitest + RTL) and a green baseline

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Modify: `package.json` (devDeps + `test` script)

- [ ] **Step 1: Confirm clean baseline build.** Run the existing build so later failures are attributable to our changes.
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: ends with `✓ Compiled successfully` / route table printed, exit 0. If it fails on a pre-existing error, stop and report — do not proceed.

- [ ] **Step 2: Install Vitest + RTL (React-19 peer deps).** Exact command:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm i -D --legacy-peer-deps vitest@^2.1.0 @vitejs/plugin-react@^4.3.0 jsdom@^25.0.0 @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.0 @testing-library/user-event@^14.5.0
  ```
  Expected: `added N packages` and exit 0. Verify: `ls node_modules/.bin/vitest` prints a path.

- [ ] **Step 3: Write `vitest.config.ts`.** Full file:
  ```ts
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import path from "node:path";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      // Playwright specs live in tests/ and use their own runner.
      exclude: ["tests/**", "node_modules/**", ".next/**"],
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, ".") },
    },
  });
  ```

- [ ] **Step 4: Write `vitest.setup.ts`.** Recharts and the shadcn sidebar read `ResizeObserver` and `matchMedia`, which jsdom lacks. Full file:
  ```ts
  import "@testing-library/jest-dom/vitest";
  import { vi } from "vitest";

  // Recharts ResponsiveContainer needs ResizeObserver.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

  // shadcn sidebar / useMediaQuery read matchMedia.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  ```

- [ ] **Step 5: Add `test` script to `package.json`.** Change the `scripts` block so it reads:
  ```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  ```

- [ ] **Step 6: Smoke-test the runner.** Create a throwaway test then run it:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && printf 'import { test, expect } from "vitest";\ntest("sanity", () => { expect(1 + 1).toBe(2); });\n' > sanity.test.ts && npm run test
  ```
  Expected: `✓ sanity.test.ts (1 test)` and `Test Files 1 passed`. Then delete it:
  ```bash
  rm /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/sanity.test.ts
  ```

- [ ] **Step 7: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git checkout -b feat/profile-builder-frontend && git add -A && git commit -m "chore(test): add vitest + react-testing-library harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 1 (PHASE 1): shadcn init + primitives + Tailwind-3 token reconciliation

**Files:**
- Create: `components.json`, `components/ui/*.tsx` (generated)
- Modify: `app/globals.css`, `tailwind.config.js`

- [ ] **Step 1: Run `shadcn init`.** Choose `new-york`, `slate`, cssVariables=yes; point it at the existing config files. Run:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx shadcn@latest init --style new-york --base-color slate --css-variables --tailwind-config tailwind.config.js --tailwind-css app/globals.css --components-alias @/components --utils-alias @/lib/utils/cn --src-dir false
  ```
  If it prompts about React-19 peer deps, choose **Use --legacy-peer-deps**. If the non-interactive flags are rejected by this CLI version, run `npx shadcn@latest init` and answer interactively: TypeScript yes, style `new-york`, base color `slate`, global CSS `app/globals.css`, CSS variables yes, Tailwind config `tailwind.config.js`, components alias `@/components`, utils alias `@/lib/utils/cn`, RSC yes, icon library `lucide`.
  Expected: writes `components.json`, may add `components/ui/`. Exit 0.

- [ ] **Step 2: Verify `components.json` content.** Run:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git --no-pager diff --no-index /dev/null components.json 2>/dev/null; cat components.json
  ```
  It MUST equal (adjust only if the `utils` alias differs because `cn` lives at `lib/utils/cn.ts`):
  ```json
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "new-york",
    "rsc": true,
    "tsx": true,
    "tailwind": {
      "config": "tailwind.config.js",
      "css": "app/globals.css",
      "baseColor": "slate",
      "cssVariables": true,
      "prefix": ""
    },
    "iconLibrary": "lucide",
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils/cn",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/lib/hooks"
    }
  }
  ```
  **Critical:** the `utils` alias must resolve to the existing `cn` (`@/lib/utils/cn`), not a new `@/lib/utils`. If shadcn created a new `lib/utils.ts`, delete it and fix `components.json` `aliases.utils` to `@/lib/utils/cn`:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && [ -f lib/utils.ts ] && rm lib/utils.ts || true
  ```

- [ ] **Step 3: Guard `app/globals.css` and `tailwind.config.js` did not get clobbered.** shadcn init may rewrite tokens. Confirm the existing HSL `:root`/`.dark` blocks and the `tailwindcss-animate` plugin still exist:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && grep -c "hsl(var(--background))" tailwind.config.js && grep -c -- "--background: 0 0% 100%" app/globals.css && grep -c "tailwindcss-animate" tailwind.config.js
  ```
  Expected: each prints `1`. If init replaced tokens with v4/oklch, `git checkout -- app/globals.css tailwind.config.js` to restore, keep only the new `components.json`, and proceed (we add tokens by hand in Steps 6–7).

- [ ] **Step 4: Add shell + chart primitives.** Single command (note: chart pulls in `recharts`; sonner pulls in `sonner`; sidebar pulls in radix sheet/tooltip/etc.):
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx shadcn@latest add card button dialog badge dropdown-menu avatar separator sheet tooltip sidebar chart sonner skeleton tabs --overwrite
  ```
  If prompted for peer deps, choose **--legacy-peer-deps**. Expected: files written under `components/ui/`. Verify:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && ls components/ui && grep -q '"recharts"' package.json && echo "recharts OK" && grep -q '"sonner"' package.json && echo "sonner OK"
  ```
  Expected: lists `avatar.tsx badge.tsx button.tsx card.tsx chart.tsx dialog.tsx dropdown-menu.tsx separator.tsx sheet.tsx sidebar.tsx skeleton.tsx sonner.tsx tabs.tsx tooltip.tsx` and prints both OK lines.

- [ ] **Step 5: DO NOT install the data-table block.** Confirm the forbidden deps did NOT sneak in:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && ! grep -qE '"@dnd-kit|@tanstack/react-table' package.json && echo "clean: no dnd-kit / react-table"
  ```
  Expected: `clean: no dnd-kit / react-table`. If they appear, `npm uninstall @dnd-kit/core @dnd-kit/sortable @dnd-kit/modifiers @dnd-kit/utilities @tanstack/react-table` and remove any generated `data-table.tsx`.

- [ ] **Step 6: Back-port `--sidebar-*` + `--chart-*` HSL tokens into `app/globals.css`.** The sidebar component references `bg-sidebar`, `text-sidebar-foreground`, etc.; on Tailwind 3 these must be HSL CSS vars. Edit `app/globals.css`: inside the existing `:root { … }` block, immediately before its closing `}`, add:
  ```css
    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
    --sidebar-ring: 217.2 91.2% 59.8%;
    --chart-1: 173 58% 39%;
    --chart-2: 12 76% 61%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
  ```
  Then inside the existing `.dark { … }` block, immediately before its closing `}`, add:
  ```css
    --sidebar-background: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  ```

- [ ] **Step 7: Mirror the sidebar + chart colors in `tailwind.config.js`.** The shadcn sidebar uses `sidebar` color keys (note: the newer shadcn sidebar uses `--sidebar` not `--sidebar-background` in some versions — verify by grepping the generated file, see Step 8). Add to `theme.extend.colors`, right after the existing `card: { … }` entry (before the closing `}` of `colors`):
  ```js
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
  ```

- [ ] **Step 8: Reconcile the sidebar var name (HARD GATE — the build is the authority).** shadcn shipped two token-naming schemes across versions: the older `--sidebar-background` and the newer bare `--sidebar`. You MUST detect which one the generated component references and reconcile deterministically — do not guess. Run:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && grep -n -- "--sidebar" components/ui/sidebar.tsx
  ```
  Read the matched lines and classify:
  - **Bare `--sidebar` token is referenced** (you see `var(--sidebar)`, `var(--sidebar-foreground)`, `var(--sidebar-accent)`, etc. with NO `-background` suffix on the base, e.g. `bg-sidebar` mapping to `--sidebar`). This is the newer scheme. You MUST add the full bare-token set to BOTH the `:root` and `.dark` blocks in `app/globals.css`. Add to `:root`:

    ```css
    --sidebar: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
    --sidebar-ring: 217.2 91.2% 59.8%;
    ```

    And add to `.dark`:

    ```css
    --sidebar: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
    ```

    Then in `tailwind.config.js` change the `sidebar.DEFAULT` mapping from `"hsl(var(--sidebar-background))"` to `"hsl(var(--sidebar))"` (leave the suffixed keys — `foreground`, `primary`, `accent`, `border`, `ring` — as-is; they already match). The `*-background` vars from Step 6 are harmless to keep.
  - **`--sidebar-background` is referenced** (the suffixed base appears). This is the older scheme already covered by Steps 6–7 — no extra var is needed; leave the `sidebar.DEFAULT → hsl(var(--sidebar-background))` mapping in place.
  - **Authority:** after editing, `npm run build` MUST pass. A Tailwind `Cannot apply unknown utility class` / `undefined CSS variable` error on a `--sidebar*` token is the definitive signal the var name in `app/globals.css` does not match the `tailwind.config.js` key the component class resolves to. Fix the mismatch (add the missing var to BOTH blocks and mirror the key in `tailwind.config.js`) and rebuild until the build is clean. Do not advance with a failing build.

- [ ] **Step 9: Add the sidebar keyframes/widths if missing (Tailwind 3).** The sidebar uses `group-data-[…]` and width transitions but no custom keyframes are strictly required for v3; confirm a build is the gate. If `components/ui/sidebar.tsx` references `--sidebar-width` inline styles, no Tailwind change is needed (it's a CSS var on the element). Skip if no error.

- [ ] **Step 10: Verification build (the token gate).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`, exit 0, no "Cannot apply unknown utility class `bg-sidebar`" Tailwind errors. If you see an unknown-utility error, the `tailwind.config.js` color key name doesn't match the component's class — fix per Step 8 and rebuild.

- [ ] **Step 11: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(ui): adopt shadcn (new-york/slate) + shell/chart primitives, back-port sidebar tokens to Tailwind 3

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: Profile types + data layer (`features/profile`)

This is foundational for both nav-user and the pages, so it comes before the shell.

**Files:**
- Create: `features/profile/types/profile.ts`, `features/profile/api/getMyProfile.ts`, `features/profile/api/disconnectGithub.ts`, `features/profile/hooks/useProfile.ts`, `features/profile/hooks/useDisconnectGithub.ts`
- Modify: `features/profile/index.ts`
- Test: `features/profile/hooks/useProfile.test.tsx`

- [ ] **Step 1: Write the types — EXACT mirror of spec §6 + §4.** Create `features/profile/types/profile.ts`:
  ```ts
  /**
   * Mirrors GET /api/v1/profile/me → ProfileResponse (spec §6) and the GitHub
   * fragment shape (spec §4). HARD RULE: no score/rank/grade/comparative field
   * appears anywhere in this contract or its UI.
   */

  export type SourceKind = "GITHUB" | "RESUME" | "LEETCODE" | "LINKEDIN" | "X";

  export interface ProfileUser {
    name: string | null;
    headline: string | null;
  }

  export interface ProfileSource {
    source: SourceKind;
    connected: boolean;
    /** ISO timestamp; present only when connected. */
    lastRefreshedAt?: string;
  }

  export interface NotableItem {
    text: string;
    source: SourceKind;
  }

  export interface SkillItem {
    skill: string;
    /** Cross-source attribution, e.g. "GitHub 48%". Never a score. */
    evidence: string;
  }

  export interface GithubLanguage {
    name: string;
    pct: number;
    bytes: number;
  }

  export interface GithubTopRepo {
    name: string;
    stars: number;
    /** Backend serializes empty string when absent, never null. */
    primaryLang: string;
  }

  export interface GithubContributions {
    lastYear: number;
    /** 52 weeks x 7 days of counts. */
    weeks: number[][];
  }

  export interface GithubFragment {
    login: string;
    /** Backend serializes empty string when absent, never null. */
    name: string;
    avatarUrl: string;
    joinedYear: number;
    publicRepos: number;
    contributions: GithubContributions;
    languages: GithubLanguage[];
    externalPRs: number;
    topRepos: GithubTopRepo[];
  }

  /**
   * LeetCode fragment is NOT produced by this slice (no collector yet). The
   * shape is declared so the data-driven charts compile; `fragments.leetcode`
   * is undefined until the LeetCode collector ships.
   */
  export interface LeetCodeFragment {
    solved: { easy: number; medium: number; hard: number };
    byTopic: { topic: string; count: number }[];
  }

  export interface ProfileFragments {
    github?: GithubFragment;
    leetcode?: LeetCodeFragment;
  }

  export interface ProvenanceItem {
    source: SourceKind;
    fragmentHash: string;
    fetchedAt: string;
  }

  export interface ProfileResponse {
    user: ProfileUser;
    sources: ProfileSource[];
    notable: NotableItem[];
    mostUsedSkills: SkillItem[];
    atAGlance: string[];
    fragments: ProfileFragments;
    provenance: ProvenanceItem[];
  }
  ```

- [ ] **Step 2: Write the read API.** Create `features/profile/api/getMyProfile.ts`:
  ```ts
  import { apiFetch } from "@/lib/api-client/client";
  import type { ProfileResponse } from "../types/profile";

  /** GET /api/v1/profile/me → consolidated, read-only profile. */
  export function getMyProfile(): Promise<ProfileResponse> {
    return apiFetch<ProfileResponse>("/api/v1/profile/me");
  }
  ```

- [ ] **Step 3: Write the disconnect API.** Create `features/profile/api/disconnectGithub.ts`:
  ```ts
  import { apiFetch } from "@/lib/api-client/client";

  /** DELETE /api/v1/connections/github → 204 (token + GitHub fragment removed). */
  export function disconnectGithub(): Promise<void> {
    return apiFetch<void>("/api/v1/connections/github", { method: "DELETE" });
  }
  ```

- [ ] **Step 4: Write the query hook.** Create `features/profile/hooks/useProfile.ts`:
  ```ts
  "use client";

  import { useQuery } from "@tanstack/react-query";
  import { getMyProfile } from "../api/getMyProfile";
  import type { ProfileResponse } from "../types/profile";

  export const PROFILE_QUERY_KEY = ["profile", "me"] as const;

  export function useProfile() {
    return useQuery<ProfileResponse>({
      queryKey: PROFILE_QUERY_KEY,
      queryFn: getMyProfile,
    });
  }
  ```

- [ ] **Step 5: Write the mutation hook.** Create `features/profile/hooks/useDisconnectGithub.ts`:
  ```ts
  "use client";

  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { disconnectGithub } from "../api/disconnectGithub";
  import { PROFILE_QUERY_KEY } from "./useProfile";

  export function useDisconnectGithub() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: disconnectGithub,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      },
    });
  }
  ```

- [ ] **Step 6: Update the barrel.** Overwrite `features/profile/index.ts`:
  ```ts
  export * from "./types/profile";
  export { getMyProfile } from "./api/getMyProfile";
  export { disconnectGithub } from "./api/disconnectGithub";
  export { useProfile, PROFILE_QUERY_KEY } from "./hooks/useProfile";
  export { useDisconnectGithub } from "./hooks/useDisconnectGithub";
  ```

- [ ] **Step 7: Write the FAILING test (TDD).** Create `features/profile/hooks/useProfile.test.tsx`. It mocks `apiFetch` and asserts the hook surfaces connected vs placeholder source states:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { renderHook, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import type { ReactNode } from "react";

  // Mock the low-level fetch wrapper so the hook → api → apiFetch chain is exercised.
  const apiFetchMock = vi.fn();
  vi.mock("@/lib/api-client/client", () => ({
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  }));

  import { useProfile } from "./useProfile";
  import type { ProfileResponse } from "../types/profile";

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const SAMPLE: ProfileResponse = {
    user: { name: "Aisha Verma", headline: null },
    sources: [
      { source: "GITHUB", connected: true, lastRefreshedAt: "2026-06-06T00:00:00Z" },
      { source: "RESUME", connected: false },
      { source: "LEETCODE", connected: false },
      { source: "LINKEDIN", connected: false },
      { source: "X", connected: false },
    ],
    notable: [{ text: "1,204 GitHub contributions in the last year", source: "GITHUB" }],
    mostUsedSkills: [{ skill: "TypeScript", evidence: "GitHub 48%" }],
    atAGlance: ["Most active in TypeScript and Python across 38 repos"],
    fragments: {
      github: {
        login: "aishav",
        name: "Aisha Verma",
        avatarUrl: "https://example.com/a.png",
        joinedYear: 2021,
        publicRepos: 38,
        contributions: { lastYear: 1204, weeks: [] },
        languages: [{ name: "TypeScript", pct: 48, bytes: 1234567 }],
        externalPRs: 17,
        topRepos: [{ name: "campus-placement-bot", stars: 42, primaryLang: "TypeScript" }],
      },
    },
    provenance: [
      { source: "GITHUB", fragmentHash: "sha256:abc", fetchedAt: "2026-06-06T00:00:00Z" },
    ],
  };

  describe("useProfile", () => {
    beforeEach(() => apiFetchMock.mockReset());

    it("calls GET /api/v1/profile/me and returns the parsed profile", async () => {
      apiFetchMock.mockResolvedValue(SAMPLE);
      const { result } = renderHook(() => useProfile(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/profile/me");
      expect(result.current.data?.user.name).toBe("Aisha Verma");
    });

    it("reports GitHub connected and other sources as placeholders", async () => {
      apiFetchMock.mockResolvedValue(SAMPLE);
      const { result } = renderHook(() => useProfile(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const byKind = Object.fromEntries(
        result.current.data!.sources.map((s) => [s.source, s.connected]),
      );
      expect(byKind.GITHUB).toBe(true);
      expect(byKind.RESUME).toBe(false);
      expect(byKind.LEETCODE).toBe(false);
    });
  });
  ```

- [ ] **Step 8: Run the test.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- useProfile
  ```
  Expected: PASS (`2 passed`) — the implementation in Steps 1–6 already satisfies it. (Because these files are pure and small, write-then-verify is the TDD loop here: the test pins the contract path `/api/v1/profile/me` and the connected/placeholder semantics. If it FAILS because `apiFetch` was called with the wrong path, fix `getMyProfile.ts`.)

- [ ] **Step 9: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(profile): ProfileResponse types + getMyProfile/disconnect data layer + useProfile hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3 (PHASE 2): App shell components + layout wiring

**Files:**
- Modify: `lib/constants/routes.ts`, `app/layout.tsx`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`
- Create: `components/nav-main.tsx`, `components/nav-secondary.tsx`, `components/nav-user.tsx`, `components/app-sidebar.tsx`, `components/site-header.tsx`

- [ ] **Step 1: Add the `connections` route constant.** In `lib/constants/routes.ts`, add a line right after `profile: "/profile",`:
  ```ts
    connections: "/connections",
  ```

- [ ] **Step 2: Mount the sonner `<Toaster />` at the root.** In `app/layout.tsx`, add the import after the `AuthProvider` import:
  ```tsx
  import { Toaster } from "@/components/ui/sonner";
  ```
  Then change the `PostHogProvider` line so the toaster renders inside it:
  ```tsx
              <PostHogProvider>
                {children}
                <Toaster />
              </PostHogProvider>
  ```

- [ ] **Step 3: Write `components/nav-main.tsx`.** Full file:
  ```tsx
  "use client";

  import Link from "next/link";
  import { usePathname } from "next/navigation";
  import type { LucideIcon } from "lucide-react";
  import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
  } from "@/components/ui/sidebar";

  export interface NavItem {
    title: string;
    url: string;
    icon: LucideIcon;
  }

  export function NavMain({ items }: { items: NavItem[] }) {
    const pathname = usePathname();
    return (
      <SidebarGroup>
        <SidebarGroupContent className="flex flex-col gap-2">
          <SidebarMenu>
            {items.map((item) => {
              const active =
                pathname === item.url || pathname.startsWith(`${item.url}/`);
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }
  ```

- [ ] **Step 4: Write `components/nav-secondary.tsx`.** Full file:
  ```tsx
  "use client";

  import Link from "next/link";
  import type { LucideIcon } from "lucide-react";
  import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
  } from "@/components/ui/sidebar";

  export interface NavSecondaryItem {
    title: string;
    url: string;
    icon: LucideIcon;
  }

  export function NavSecondary({
    items,
    ...props
  }: { items: NavSecondaryItem[] } & React.ComponentPropsWithoutRef<
    typeof SidebarGroup
  >) {
    return (
      <SidebarGroup {...props}>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }
  ```

- [ ] **Step 5: Write `components/nav-user.tsx`.** Name/avatar come from `useProfile`; logout from `useAuth`. Full file:
  ```tsx
  "use client";

  import { useRouter } from "next/navigation";
  import { ChevronsUpDown, LogOut, UserCircle } from "lucide-react";
  import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
  } from "@/components/ui/sidebar";
  import { useAuth } from "@/lib/auth/AuthProvider";
  import { useProfile } from "@/features/profile";
  import { ROUTES } from "@/lib/constants/routes";

  export function NavUser() {
    const { isMobile } = useSidebar();
    const { logout } = useAuth();
    const router = useRouter();
    const { data } = useProfile();

    const name = data?.user.name ?? "Your account";
    const avatarUrl = data?.fragments.github?.avatarUrl;
    const initials = name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

    async function handleLogout() {
      await logout();
      router.replace(ROUTES.login);
    }

    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg grayscale">
                  {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
                  <AvatarFallback className="rounded-lg">
                    {initials || <UserCircle className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <span className="truncate font-medium">{name}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => router.push(ROUTES.profile)}>
                  <UserCircle />
                  Profile
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }
  ```

- [ ] **Step 6: Write `components/app-sidebar.tsx`.** navMain = Dashboard/Profile/Connections. Full file:
  ```tsx
  "use client";

  import Link from "next/link";
  import {
    LayoutDashboard,
    Link2,
    LifeBuoy,
    Sparkles,
    UserCircle,
  } from "lucide-react";
  import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
  } from "@/components/ui/sidebar";
  import { NavMain, type NavItem } from "@/components/nav-main";
  import { NavSecondary, type NavSecondaryItem } from "@/components/nav-secondary";
  import { NavUser } from "@/components/nav-user";
  import { ROUTES } from "@/lib/constants/routes";

  const navMain: NavItem[] = [
    { title: "Dashboard", url: ROUTES.dashboard, icon: LayoutDashboard },
    { title: "Profile", url: ROUTES.profile, icon: UserCircle },
    { title: "Connections", url: ROUTES.connections, icon: Link2 },
  ];

  const navSecondary: NavSecondaryItem[] = [
    { title: "Help", url: ROUTES.help, icon: LifeBuoy },
  ];

  export function AppSidebar(
    props: React.ComponentPropsWithoutRef<typeof Sidebar>,
  ) {
    return (
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
                <Link href={ROUTES.dashboard}>
                  <Sparkles className="!size-5" />
                  <span className="text-base font-semibold">InterviewIQ</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navMain} />
          <NavSecondary items={navSecondary} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </Sidebar>
    );
  }
  ```

- [ ] **Step 7: Write `components/site-header.tsx`.** Title derived from the path. Full file:
  ```tsx
  "use client";

  import { usePathname } from "next/navigation";
  import { Separator } from "@/components/ui/separator";
  import { SidebarTrigger } from "@/components/ui/sidebar";

  const TITLES: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/profile": "Profile",
    "/connections": "Connections",
  };

  function titleFor(pathname: string): string {
    if (TITLES[pathname]) return TITLES[pathname];
    const match = Object.keys(TITLES).find((p) => pathname.startsWith(`${p}/`));
    return match ? TITLES[match] : "InterviewIQ";
  }

  export function SiteHeader() {
    const pathname = usePathname();
    return (
      <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          <h1 className="text-base font-medium">{titleFor(pathname)}</h1>
        </div>
      </header>
    );
  }
  ```
  Note: if the generated `sidebar.tsx` in this shadcn version does not define `--header-height`, the `h-(--header-height)` class falls back to auto — to be safe, after wiring set an explicit height in the layout wrapper style (Step 8).

- [ ] **Step 8: Wire `app/(app)/layout.tsx`.** Overwrite the whole file. `RequireAuth` stays the outermost gate; the shell lives inside it. `--header-height` is supplied via inline style so `SiteHeader` has a height regardless of shadcn version:
  ```tsx
  import { RequireAuth } from "@/components/auth/RequireAuth";
  import { AppSidebar } from "@/components/app-sidebar";
  import { SiteHeader } from "@/components/site-header";
  import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

  export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
      <RequireAuth>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "16rem",
              "--header-height": "3.5rem",
            } as React.CSSProperties
          }
        >
          <AppSidebar variant="inset" />
          <SidebarInset>
            <SiteHeader />
            <div className="flex flex-1 flex-col">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </RequireAuth>
    );
  }
  ```

- [ ] **Step 9: Make `/dashboard` a real placeholder (not a 404).** Overwrite `app/(app)/dashboard/page.tsx`:
  ```tsx
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

  export default function DashboardPage() {
    return (
      <main className="flex-1 space-y-6 p-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Your interview prep at a glance.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
            <CardDescription>
              Practice stats and recent sessions will appear here. For now, build
              your profile by connecting sources.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Head to Connections to link your GitHub account.
          </CardContent>
        </Card>
      </main>
    );
  }
  ```

- [ ] **Step 10: Write the app-shell nav test (spec §9: sidebar renders Dashboard/Profile/Connections links; NavUser bound).** Create `components/app-sidebar.test.tsx`. It mocks `useProfile` (so `NavUser` shows the profile-derived name) plus `useAuth`/`next/navigation` (NavUser deps), renders `AppSidebar` inside a `SidebarProvider`, and asserts the three nav links render with the correct hrefs and that the user name is bound from the profile. Same import/mock/render style as the other RTL tests in this plan. Full file:
  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";

  // NavUser sources its display name/avatar from useProfile.
  vi.mock("@/features/profile", () => ({
    useProfile: () => ({
      data: {
        user: { name: "Aisha Verma", headline: null },
        fragments: { github: { avatarUrl: "https://example.com/a.png" } },
      },
    }),
  }));

  // NavUser also reads useAuth().logout and the router; stub both.
  vi.mock("@/lib/auth/AuthProvider", () => ({
    useAuth: () => ({ logout: vi.fn() }),
  }));
  vi.mock("next/navigation", async () => {
    const actual = await vi.importActual<typeof import("next/navigation")>(
      "next/navigation",
    );
    return {
      ...actual,
      usePathname: () => "/dashboard",
      useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    };
  });

  import { AppSidebar } from "./app-sidebar";
  import { SidebarProvider } from "@/components/ui/sidebar";

  function renderSidebar() {
    return render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );
  }

  describe("AppSidebar", () => {
    it("renders the three primary nav links with correct hrefs", () => {
      renderSidebar();
      expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
        "href",
        "/dashboard",
      );
      expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute(
        "href",
        "/profile",
      );
      expect(screen.getByRole("link", { name: /connections/i })).toHaveAttribute(
        "href",
        "/connections",
      );
    });

    it("binds NavUser to the profile-derived name", () => {
      renderSidebar();
      expect(screen.getByText("Aisha Verma")).toBeInTheDocument();
    });
  });
  ```
  Note: `SidebarProvider` supplies the `useSidebar()` context that `NavUser` reads (`isMobile`); without it the render throws. The `matchMedia`/`ResizeObserver` polyfills from Task 0 (`vitest.setup.ts`) must be loaded for the sidebar to mount. The brand "InterviewIQ" link also points at `/dashboard`, so the Dashboard assertion uses the nav item's accessible name `dashboard` (the brand link's name is "InterviewIQ").

- [ ] **Step 11: Run the nav test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- app-sidebar
  ```
  Expected: `2 passed`. If `getByText("Aisha Verma")` matches twice (the trigger and the dropdown label both render the name), switch that assertion to `screen.getAllByText("Aisha Verma").length` ≥ 1; the dropdown content is closed by default so a single match is expected.

- [ ] **Step 12: Verification build.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`, exit 0. If `lucide-react` complains an icon doesn't exist (e.g. `LifeBuoy`/`Sparkles`/`ChevronsUpDown`), confirm against the installed version:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && node -e "const m=require('lucide-react');['LayoutDashboard','UserCircle','Link2','LifeBuoy','Sparkles','ChevronsUpDown','LogOut'].forEach(n=>console.log(n, typeof m[n]))"
  ```
  Each must print `object`. If any is `undefined`, this is the lucide-version flag firing — pick the nearest existing icon or `npm i lucide-react@latest --legacy-peer-deps` and rebuild.

- [ ] **Step 13: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(shell): app sidebar + nav + site-header wired into (app) layout inside RequireAuth + nav test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4 (PHASE 4a): GitHub custom visualizations (heatmap + stat tiles)

Charts before pages so the profile page composes finished pieces. Custom (non-Recharts) parts first.

**Files:**
- Create: `components/visualizations/ContributionHeatmap.tsx`, `components/visualizations/GithubStatTiles.tsx`

- [ ] **Step 1: Write `components/visualizations/ContributionHeatmap.tsx`.** CUSTOM 52×7 Tailwind grid, intensity bins, no chart lib, no ranking text. Full file:
  ```tsx
  import { cn } from "@/lib/utils/cn";

  /** 52 weeks x 7 days of contribution counts (spec §4). */
  export interface ContributionHeatmapProps {
    weeks: number[][];
    totalLastYear: number;
  }

  /** Map a count to one of 5 intensity bins (0 = none). Descriptive only. */
  function bin(count: number, max: number): number {
    if (count <= 0 || max <= 0) return 0;
    const ratio = count / max;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  }

  const BIN_CLASS = [
    "bg-muted",
    "bg-emerald-900",
    "bg-emerald-700",
    "bg-emerald-500",
    "bg-emerald-300",
  ];

  export function ContributionHeatmap({ weeks, totalLastYear }: ContributionHeatmapProps) {
    const max = weeks.reduce(
      (acc, w) => Math.max(acc, ...(w.length ? w : [0])),
      0,
    );

    if (!weeks.length) {
      return (
        <p className="text-sm text-muted-foreground">No contribution data yet.</p>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {totalLastYear.toLocaleString()} contributions in the last year
        </p>
        <div
          className="flex gap-[3px] overflow-x-auto"
          role="img"
          aria-label={`GitHub contribution heatmap, ${totalLastYear} contributions in the last year`}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((count, di) => (
                <span
                  key={di}
                  title={`${count} contributions`}
                  className={cn(
                    "h-[11px] w-[11px] rounded-[2px]",
                    BIN_CLASS[bin(count, max)],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Less</span>
          {BIN_CLASS.map((c, i) => (
            <span key={i} className={cn("h-[11px] w-[11px] rounded-[2px]", c)} />
          ))}
          <span>More</span>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Write `components/visualizations/GithubStatTiles.tsx`.** CUSTOM shadcn `Card` tiles, mono numerals, lucide icons, no ranking. Full file:
  ```tsx
  import { GitPullRequest, FolderGit2, CalendarDays, Star } from "lucide-react";
  import { Card, CardContent } from "@/components/ui/card";
  import type { GithubFragment } from "@/features/profile";

  interface Tile {
    label: string;
    value: string;
    icon: typeof Star;
  }

  export function GithubStatTiles({ github }: { github: GithubFragment }) {
    const totalStars = github.topRepos.reduce((sum, r) => sum + r.stars, 0);
    const tiles: Tile[] = [
      { label: "Public repos", value: github.publicRepos.toLocaleString(), icon: FolderGit2 },
      { label: "External PRs", value: github.externalPRs.toLocaleString(), icon: GitPullRequest },
      { label: "Stars on top repos", value: totalStars.toLocaleString(), icon: Star },
      { label: "On GitHub since", value: String(github.joinedYear), icon: CalendarDays },
    ];

    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="flex flex-col gap-1 p-4">
              <t.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {t.value}
              </span>
              <span className="text-xs text-muted-foreground">{t.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 3: Build to confirm both compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(viz): custom GitHub contribution heatmap + stat tiles (no scoring)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5 (PHASE 4b): Recharts visualizations (language pie, LeetCode pie + bar) — TDD

**Files:**
- Create: `components/visualizations/LanguageDistribution.tsx`, `components/visualizations/LeetCodeDifficulty.tsx`, `components/visualizations/LeetCodeTopics.tsx`
- Test: `components/visualizations/LanguageDistribution.test.tsx`

- [ ] **Step 1: Write the FAILING test first (TDD).** Create `components/visualizations/LanguageDistribution.test.tsx`. It renders from fragment data and asserts NO ranking/scoring text:
  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { LanguageDistribution } from "./LanguageDistribution";
  import type { GithubLanguage } from "@/features/profile";

  const LANGS: GithubLanguage[] = [
    { name: "TypeScript", pct: 48, bytes: 1234567 },
    { name: "Python", pct: 32, bytes: 800000 },
    { name: "Go", pct: 20, bytes: 500000 },
  ];

  describe("LanguageDistribution", () => {
    // These names come from the component's own <ul> legend rendered OUTSIDE
    // Recharts (Recharts renders 0x0 in jsdom), so the assertions are reliable.
    it("renders a legend entry per language", () => {
      render(<LanguageDistribution languages={LANGS} />);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText("Python")).toBeInTheDocument();
      expect(screen.getByText("Go")).toBeInTheDocument();
    });

    it("shows an empty state when there is no data", () => {
      render(<LanguageDistribution languages={[]} />);
      expect(screen.getByText(/no language data/i)).toBeInTheDocument();
    });

    it("contains no scoring or ranking language", () => {
      const { container } = render(<LanguageDistribution languages={LANGS} />);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/score|rank|grade|top \d+%|percentile|better than|above average/i);
    });
  });
  ```

- [ ] **Step 2: Run it — expect FAIL.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- LanguageDistribution
  ```
  Expected: FAIL with `Failed to resolve import "./LanguageDistribution"` (file doesn't exist yet).

- [ ] **Step 3: Write `components/visualizations/LanguageDistribution.tsx`.** shadcn chart base + Recharts `PieChart`, PLUS an own-markup legend rendered OUTSIDE the Recharts tree so the language names are reliably in the DOM in jsdom (Recharts `ResponsiveContainer` renders 0×0 there). Full file:
  ```tsx
  "use client";

  import { Pie, PieChart } from "recharts";
  import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
  } from "@/components/ui/chart";
  import type { GithubLanguage } from "@/features/profile";

  const COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  export function LanguageDistribution({ languages }: { languages: GithubLanguage[] }) {
    if (!languages.length) {
      return <p className="text-sm text-muted-foreground">No language data yet.</p>;
    }

    const data = languages.map((l, i) => ({
      name: l.name,
      pct: l.pct,
      fill: COLORS[i % COLORS.length],
    }));

    const config: ChartConfig = Object.fromEntries(
      languages.map((l, i) => [
        l.name,
        { label: l.name, color: `hsl(var(--chart-${(i % 5) + 1}))` },
      ]),
    );

    return (
      <div className="space-y-3">
        <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie data={data} dataKey="pct" nameKey="name" innerRadius={48} strokeWidth={2} />
          </PieChart>
        </ChartContainer>
        {/* Own-markup legend OUTSIDE Recharts: deterministic DOM text in jsdom. */}
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {data.map((d) => (
            <li key={d.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: d.fill }}
              />
              <span>{d.name}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```
  Note: the legend names come from our own `<ul>` markup rendered outside the Recharts tree, so `screen.getByText("TypeScript")` etc. resolve deterministically in jsdom regardless of whether Recharts paints anything. There is no ranking/scoring text anywhere — only language names and percentages via the tooltip.

- [ ] **Step 4: Run the test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- LanguageDistribution
  ```
  Expected: `3 passed`. This is reliable in jsdom by construction: the test asserts against the plain `<ul>` legend the component renders OUTSIDE the Recharts tree (see Step 3), NOT against any text Recharts paints inside its SVG. Recharts' `ResponsiveContainer` renders 0×0 in jsdom and emits no measurable SVG, so any assertion on in-SVG text would be flaky — the out-of-chart legend markup is the deterministic source of the language names. The `matchMedia`/`ResizeObserver` polyfills from Task 0 (`vitest.setup.ts`) only need to be present so `ChartContainer` mounts without throwing; they are not load-bearing for the assertions.

- [ ] **Step 5: Write `components/visualizations/LeetCodeDifficulty.tsx`.** Pie, Easy/Med/Hard color-coded, empty-safe (LeetCode data is absent this slice). Full file:
  ```tsx
  "use client";

  import { Pie, PieChart } from "recharts";
  import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    ChartLegend,
    ChartLegendContent,
    type ChartConfig,
  } from "@/components/ui/chart";
  import type { LeetCodeFragment } from "@/features/profile";

  const config: ChartConfig = {
    easy: { label: "Easy", color: "hsl(142 71% 45%)" },
    medium: { label: "Medium", color: "hsl(38 92% 50%)" },
    hard: { label: "Hard", color: "hsl(0 72% 51%)" },
  };

  export function LeetCodeDifficulty({ solved }: { solved?: LeetCodeFragment["solved"] }) {
    const total = solved ? solved.easy + solved.medium + solved.hard : 0;
    if (!solved || total === 0) {
      return <p className="text-sm text-muted-foreground">No LeetCode data yet.</p>;
    }

    const data = [
      { key: "easy", label: "Easy", value: solved.easy, fill: "hsl(142 71% 45%)" },
      { key: "medium", label: "Medium", value: solved.medium, fill: "hsl(38 92% 50%)" },
      { key: "hard", label: "Hard", value: solved.hard, fill: "hsl(0 72% 51%)" },
    ];

    return (
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} strokeWidth={2} />
          <ChartLegend content={<ChartLegendContent nameKey="label" />} />
        </PieChart>
      </ChartContainer>
    );
  }
  ```

- [ ] **Step 6: Write `components/visualizations/LeetCodeTopics.tsx`.** Bar chart, empty-safe. Full file:
  ```tsx
  "use client";

  import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
  import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
  } from "@/components/ui/chart";
  import type { LeetCodeFragment } from "@/features/profile";

  const config: ChartConfig = {
    count: { label: "Solved", color: "hsl(var(--chart-1))" },
  };

  export function LeetCodeTopics({ byTopic }: { byTopic?: LeetCodeFragment["byTopic"] }) {
    if (!byTopic || byTopic.length === 0) {
      return <p className="text-sm text-muted-foreground">No LeetCode topic data yet.</p>;
    }

    return (
      <ChartContainer config={config} className="max-h-[280px] w-full">
        <BarChart accessibilityLayer data={byTopic} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="topic"
            tickLine={false}
            axisLine={false}
            width={96}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>
    );
  }
  ```

- [ ] **Step 7: Build + run full test suite.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: build `✓ Compiled successfully`; tests `Test Files 3 passed` (useProfile, app-sidebar, LanguageDistribution), exit 0.

- [ ] **Step 8: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(viz): language pie + LeetCode difficulty/topics charts (data-driven, empty-safe, no ranking)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6 (PHASE 5a): Provider registry + connection sub-components

**Files:**
- Create: `app/(app)/connections/_components/providers.ts`, `SourceIcon.tsx`, `ConnectionStatus.tsx`, `ConnectionButton.tsx`, `DisconnectDialog.tsx`, `ProviderCard.tsx`
- Test: `app/(app)/connections/_components/ConnectionButton.test.tsx`

- [ ] **Step 1: Write the provider registry.** Create `app/(app)/connections/_components/providers.ts`:
  ```ts
  import type { SourceKind } from "@/features/profile";

  export interface ProviderMeta {
    source: SourceKind;
    label: string;
    description: string;
    /** Only GitHub is live this slice; the rest are "Connect" placeholders. */
    live: boolean;
  }

  export const PROVIDERS: ProviderMeta[] = [
    {
      source: "GITHUB",
      label: "GitHub",
      description: "Languages, repos, contributions and external PRs.",
      live: true,
    },
    {
      source: "RESUME",
      label: "Résumé",
      description: "Work history, education, projects and achievements.",
      live: false,
    },
    {
      source: "LEETCODE",
      label: "LeetCode",
      description: "Solved problems by difficulty and topic.",
      live: false,
    },
    {
      source: "LINKEDIN",
      label: "LinkedIn",
      description: "Professional profile (coming later).",
      live: false,
    },
    {
      source: "X",
      label: "X",
      description: "Public handle for link-out (coming later).",
      live: false,
    },
  ];
  ```

- [ ] **Step 2: Write `SourceIcon.tsx`.** Create `app/(app)/connections/_components/SourceIcon.tsx`:
  ```tsx
  import { Github, FileText, Code2, Linkedin, Twitter, type LucideIcon } from "lucide-react";
  import type { SourceKind } from "@/features/profile";

  const ICONS: Record<SourceKind, LucideIcon> = {
    GITHUB: Github,
    RESUME: FileText,
    LEETCODE: Code2,
    LINKEDIN: Linkedin,
    X: Twitter,
  };

  export function SourceIcon({
    source,
    className,
  }: {
    source: SourceKind;
    className?: string;
  }) {
    const Icon = ICONS[source];
    return <Icon className={className} aria-hidden />;
  }
  ```

- [ ] **Step 3: Write `ConnectionStatus.tsx`.** Create `app/(app)/connections/_components/ConnectionStatus.tsx`. The state machine: `not-connected | connecting | connected | error | refreshing`:
  ```tsx
  import { Badge } from "@/components/ui/badge";
  import { cn } from "@/lib/utils/cn";

  export type ConnectionState =
    | "not-connected"
    | "connecting"
    | "connected"
    | "error"
    | "refreshing";

  const LABELS: Record<ConnectionState, string> = {
    "not-connected": "Not connected",
    connecting: "Connecting…",
    connected: "Connected",
    error: "Error",
    refreshing: "Refreshing…",
  };

  export function ConnectionStatus({ state }: { state: ConnectionState }) {
    return (
      <Badge
        role="status"
        aria-label={`Connection status: ${LABELS[state]}`}
        variant={
          state === "connected"
            ? "default"
            : state === "error"
              ? "destructive"
              : "secondary"
        }
        className={cn(state === "not-connected" && "text-muted-foreground")}
      >
        {LABELS[state]}
      </Badge>
    );
  }
  ```

- [ ] **Step 4: Write the FAILING test for ConnectionButton (TDD).** Create `app/(app)/connections/_components/ConnectionButton.test.tsx`. It asserts the Connect button navigates the browser to the authorize endpoint:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";

  // APP_CONFIG.apiUrl reads NEXT_PUBLIC_API_URL at import time; stub the module.
  vi.mock("@/lib/constants/config", () => ({
    APP_CONFIG: { apiUrl: "http://localhost:8080" },
  }));

  import { ConnectionButton } from "./ConnectionButton";

  describe("ConnectionButton", () => {
    beforeEach(() => {
      // jsdom forbids assigning window.location.href directly; replace the object.
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "" },
      });
    });

    it("navigates to the GitHub authorize endpoint on click", async () => {
      const user = userEvent.setup();
      render(<ConnectionButton source="GITHUB" />);
      await user.click(screen.getByRole("button", { name: /connect github/i }));
      expect(window.location.href).toBe(
        "http://localhost:8080/api/v1/connections/github/authorize",
      );
    });
  });
  ```

- [ ] **Step 5: Run it — expect FAIL.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- ConnectionButton
  ```
  Expected: FAIL — `Failed to resolve import "./ConnectionButton"`.

- [ ] **Step 6: Write `ConnectionButton.tsx`.** Create `app/(app)/connections/_components/ConnectionButton.tsx`. Uses `window.location` + `APP_CONFIG.apiUrl` exactly like `lib/auth/client.ts`:
  ```tsx
  "use client";

  import { Github } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { APP_CONFIG } from "@/lib/constants/config";
  import type { SourceKind } from "@/features/profile";

  /** Maps a source to its backend authorize endpoint. Only GitHub is live. */
  const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
    GITHUB: "/api/v1/connections/github/authorize",
  };

  export function ConnectionButton({ source }: { source: SourceKind }) {
    const path = AUTHORIZE_PATH[source];

    function connect() {
      if (!path) return;
      window.location.href = `${APP_CONFIG.apiUrl}${path}`;
    }

    if (!path) {
      return (
        <Button variant="secondary" disabled>
          Coming soon
        </Button>
      );
    }

    return (
      <Button onClick={connect} aria-label={`Connect ${source.toLowerCase()}`}>
        <Github className="mr-2 h-4 w-4" aria-hidden />
        Connect GitHub
      </Button>
    );
  }
  ```

- [ ] **Step 7: Run the test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- ConnectionButton
  ```
  Expected: `1 passed`.

- [ ] **Step 8: Write `DisconnectDialog.tsx`.** Create `app/(app)/connections/_components/DisconnectDialog.tsx`. Uses `useDisconnectGithub`; errors via `sonner` toast:
  ```tsx
  "use client";

  import { useState } from "react";
  import { toast } from "sonner";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Button } from "@/components/ui/button";
  import { useDisconnectGithub } from "@/features/profile";

  export function DisconnectDialog({ label }: { label: string }) {
    const [open, setOpen] = useState(false);
    const { mutate, isPending } = useDisconnectGithub();

    function handleConfirm() {
      mutate(undefined, {
        onSuccess: () => {
          setOpen(false);
          toast.success(`${label} disconnected`);
        },
        onError: () => {
          toast.error(`Could not disconnect ${label}. Please try again.`);
        },
      });
    }

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Disconnect</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {label}?</DialogTitle>
            <DialogDescription>
              This removes the connection and its synced data from your profile.
              You can reconnect any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```

- [ ] **Step 9: Write the disconnect-flow test (spec §9: disconnect mutation + state flip).** Create `app/(app)/connections/_components/DisconnectDialog.test.tsx`. It mocks `useDisconnectGithub` (mutate as a `vi.fn`) and `sonner`, renders the dialog open, clicks **Disconnect**, asserts the mutate fn fired, and asserts the success path runs (success toast) and the dialog closes. Same import/mock/render style as `ConnectionButton.test.tsx`. Full file:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen, waitFor } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";

  // Mock the mutation hook: capture mutate and drive its onSuccess synchronously
  // so the dialog's success path (close + toast.success) runs in the test.
  const mutateMock = vi.fn(
    (
      _vars: unknown,
      opts?: { onSuccess?: () => void; onError?: () => void },
    ) => {
      opts?.onSuccess?.();
    },
  );
  vi.mock("@/features/profile", () => ({
    useDisconnectGithub: () => ({ mutate: mutateMock, isPending: false }),
  }));

  // Mock sonner so we can assert the success toast without a real Toaster.
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  vi.mock("sonner", () => ({
    toast: { success: toastSuccess, error: toastError },
  }));

  import { DisconnectDialog } from "./DisconnectDialog";

  describe("DisconnectDialog", () => {
    beforeEach(() => {
      mutateMock.mockClear();
      toastSuccess.mockClear();
      toastError.mockClear();
    });

    it("calls the disconnect mutation and runs the success path on confirm", async () => {
      const user = userEvent.setup();
      render(<DisconnectDialog label="GitHub" />);

      // Open the dialog via its trigger.
      await user.click(screen.getByRole("button", { name: /^disconnect$/i }));

      // The confirm dialog is now open with its destructive Disconnect button.
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();

      // Click the destructive confirm button inside the dialog.
      const confirm = screen
        .getAllByRole("button", { name: /^disconnect$/i })
        .at(-1)!;
      await user.click(confirm);

      // Mutation fired exactly once.
      expect(mutateMock).toHaveBeenCalledTimes(1);

      // Success path: toast fired and the dialog closed (state flip).
      expect(toastSuccess).toHaveBeenCalledWith("GitHub disconnected");
      expect(toastError).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    });
  });
  ```
  Note: `mutateMock` invokes the `onSuccess` callback it receives, which mirrors how `useMutation` resolves a 204 disconnect — that is what flips `open` to `false` (dialog closes) and fires `toast.success`. No real `QueryClientProvider` is needed because the hook is mocked.

- [ ] **Step 10: Run the disconnect test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test -- DisconnectDialog
  ```
  Expected: `1 passed`. If the confirm-button query is ambiguous, the `.at(-1)` selector deliberately targets the dialog's destructive button (the trigger is the first match, the footer confirm is the last). If the dialog does not close, verify `DisconnectDialog`'s `onSuccess` calls `setOpen(false)` before `toast.success` (Step 8).

- [ ] **Step 11: Write `ProviderCard.tsx`.** Create `app/(app)/connections/_components/ProviderCard.tsx`. The state-machine card. The `refreshing` state + Refresh affordance are **defined but hidden** (no refresh endpoint exists). Reads `errored` from the page's `?error=` handling:
  ```tsx
  "use client";

  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { ConnectionButton } from "./ConnectionButton";
  import { DisconnectDialog } from "./DisconnectDialog";
  import { ConnectionStatus, type ConnectionState } from "./ConnectionStatus";
  import { SourceIcon } from "./SourceIcon";
  import type { ProviderMeta } from "./providers";

  /** Future refresh affordance — intentionally hidden until the endpoint ships. */
  const SHOW_REFRESH = false;

  export interface ProviderCardProps {
    provider: ProviderMeta;
    connected: boolean;
    lastRefreshedAt?: string;
    errored?: boolean;
  }

  function deriveState(p: ProviderCardProps): ConnectionState {
    if (p.errored) return "error";
    if (p.connected) return "connected";
    return "not-connected";
  }

  export function ProviderCard(props: ProviderCardProps) {
    const { provider, connected, lastRefreshedAt, errored } = props;
    const state = deriveState(props);

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SourceIcon source={provider.source} className="h-5 w-5" />
              <CardTitle className="text-base">{provider.label}</CardTitle>
            </div>
            <ConnectionStatus state={state} />
          </div>
          <CardDescription>{provider.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {connected && lastRefreshedAt ? (
            <p className="text-xs text-muted-foreground">
              Last refreshed {new Date(lastRefreshedAt).toLocaleDateString()}
            </p>
          ) : null}
          {errored ? (
            <p className="text-xs text-destructive">
              Connection failed. Please try connecting again.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {connected ? (
              <>
                {SHOW_REFRESH ? (
                  <button type="button" className="text-sm underline">
                    Refresh
                  </button>
                ) : null}
                {provider.live ? <DisconnectDialog label={provider.label} /> : null}
              </>
            ) : (
              <ConnectionButton source={provider.source} />
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 12: Build + test.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: build OK; `Test Files 5 passed` (useProfile, LanguageDistribution, ConnectionButton, DisconnectDialog, app-sidebar).

- [ ] **Step 13: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(connections): provider registry + state-machine ProviderCard, ConnectionButton (TDD), DisconnectDialog + disconnect test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7 (PHASE 5b): Connections page + redirect the two stubs

**Files:**
- Create: `app/(app)/connections/page.tsx`, `app/(app)/connections/_components/ConnectionsGrid.tsx`
- Modify: `app/(app)/profile/connections/page.tsx`, `app/(app)/onboarding/connections/page.tsx`

- [ ] **Step 1: Write `ConnectionsGrid.tsx`.** Create `app/(app)/connections/_components/ConnectionsGrid.tsx`. Maps `PROVIDERS` × `profile.sources`:
  ```tsx
  "use client";

  import { ProviderCard } from "./ProviderCard";
  import { PROVIDERS } from "./providers";
  import { useProfile, type SourceKind } from "@/features/profile";
  import { Skeleton } from "@/components/ui/skeleton";

  export function ConnectionsGrid({ errorSource }: { errorSource?: SourceKind }) {
    const { data, isLoading, isError } = useProfile();

    if (isLoading) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => (
            <Skeleton key={p.source} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      );
    }

    if (isError || !data) {
      return (
        <p className="text-sm text-destructive">
          Could not load your connections. Please refresh the page.
        </p>
      );
    }

    const byKind = Object.fromEntries(data.sources.map((s) => [s.source, s]));

    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const src = byKind[provider.source];
          return (
            <ProviderCard
              key={provider.source}
              provider={provider}
              connected={Boolean(src?.connected)}
              lastRefreshedAt={src?.lastRefreshedAt}
              errored={errorSource === provider.source}
            />
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 2: Write the connections page.** Create `app/(app)/connections/page.tsx`. Reads `?error=` (a `?error=github` query surfaces the GitHub OAuth failure on its card). Next 16 `searchParams` is async:
  ```tsx
  import type { SourceKind } from "@/features/profile";
  import { ConnectionsGrid } from "./_components/ConnectionsGrid";

  /** Map the backend's ?error= value to a source so its card shows the error. */
  function errorToSource(error?: string): SourceKind | undefined {
    if (!error) return undefined;
    if (error.toLowerCase().includes("github")) return "GITHUB";
    return undefined;
  }

  export default async function ConnectionsPage({
    searchParams,
  }: {
    searchParams: Promise<{ error?: string }>;
  }) {
    const { error } = await searchParams;
    const errorSource = errorToSource(error);

    return (
      <main className="flex-1 space-y-6 p-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Connections</h2>
          <p className="text-sm text-muted-foreground">
            Connect your accounts to build your profile. We only read public data.
          </p>
        </div>
        <ConnectionsGrid errorSource={errorSource} />
      </main>
    );
  }
  ```

- [ ] **Step 3: Convert the profile/connections stub to a redirect.** Overwrite `app/(app)/profile/connections/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";
  import { ROUTES } from "@/lib/constants/routes";

  /** The connections hub now lives at the top level. */
  export default function ProfileConnectionsRedirect() {
    redirect(ROUTES.connections);
  }
  ```

- [ ] **Step 4: Convert the onboarding/connections stub to a redirect.** Overwrite `app/(app)/onboarding/connections/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";
  import { ROUTES } from "@/lib/constants/routes";

  /** Onboarding shares the single connections hub. */
  export default function OnboardingConnectionsRedirect() {
    redirect(ROUTES.connections);
  }
  ```

- [ ] **Step 5: Build.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`. The route table shows `/connections`, and `/profile/connections` + `/onboarding/connections` build as redirect routes.

- [ ] **Step 6: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(connections): /connections hub page + grid; redirect legacy connection stubs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 8 (PHASE 3): Profile page (Layout A, read-only)

**Files:**
- Create: `app/(app)/profile/_components/AtAGlance.tsx`
- Modify: `app/(app)/profile/page.tsx`

- [ ] **Step 1: Write the highlights band component.** Create `app/(app)/profile/_components/AtAGlance.tsx`. Renders `atAGlance` + `notable` + `mostUsedSkills` — descriptive only, evidence on every skill, no scores:
  ```tsx
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import type { NotableItem, SkillItem } from "@/features/profile";

  export interface AtAGlanceProps {
    atAGlance: string[];
    notable: NotableItem[];
    mostUsedSkills: SkillItem[];
  }

  export function AtAGlance({ atAGlance, notable, mostUsedSkills }: AtAGlanceProps) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent>
            {atAGlance.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {atAGlance.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect a source to see your highlights.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notable</CardTitle>
          </CardHeader>
          <CardContent>
            {notable.length ? (
              <ul className="space-y-2 text-sm">
                {notable.map((n, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <span>{n.text}</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {n.source}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Most-used skills</CardTitle>
          </CardHeader>
          <CardContent>
            {mostUsedSkills.length ? (
              <ul className="space-y-2 text-sm">
                {mostUsedSkills.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="font-medium">{s.skill}</span>
                    <span className="text-xs text-muted-foreground">{s.evidence}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No skills detected yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 2: Write the profile page.** Overwrite `app/(app)/profile/page.tsx`. Read-only Layout A: header band + GitHub source card (stat tiles, language pie, heatmap) + LeetCode placeholder + "Manage connections" link. This is a client page (it uses `useProfile`):
  ```tsx
  "use client";

  import Link from "next/link";
  import { useProfile } from "@/features/profile";
  import { ROUTES } from "@/lib/constants/routes";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Skeleton } from "@/components/ui/skeleton";
  import { AtAGlance } from "./_components/AtAGlance";
  import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
  import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
  import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
  import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
  import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";

  export default function ProfilePage() {
    const { data, isLoading, isError } = useProfile();

    if (isLoading) {
      return (
        <main className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      );
    }

    if (isError || !data) {
      return (
        <main className="flex-1 p-6">
          <p className="text-sm text-destructive">
            Could not load your profile. Please refresh the page.
          </p>
        </main>
      );
    }

    const github = data.fragments.github;
    const leetcode = data.fragments.leetcode;
    const githubConnected = data.sources.some(
      (s) => s.source === "GITHUB" && s.connected,
    );

    return (
      <main className="flex-1 space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {data.user.name ?? "Your profile"}
            </h2>
            {data.user.headline ? (
              <p className="text-sm text-muted-foreground">{data.user.headline}</p>
            ) : null}
          </div>
          <Button asChild variant="outline">
            <Link href={ROUTES.connections}>Manage connections</Link>
          </Button>
        </div>

        <AtAGlance
          atAGlance={data.atAGlance}
          notable={data.notable}
          mostUsedSkills={data.mostUsedSkills}
        />

        {githubConnected && github ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GitHub</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <GithubStatTiles github={github} />
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium">Languages</h3>
                  <LanguageDistribution languages={github.languages} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Contributions</h3>
                  <ContributionHeatmap
                    weeks={github.contributions.weeks}
                    totalLastYear={github.contributions.lastYear}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GitHub</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Connect GitHub to see your languages, repos and contributions.
              </p>
              <Button asChild>
                <Link href={ROUTES.connections}>Connect</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">LeetCode</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">By difficulty</h3>
              <LeetCodeDifficulty solved={leetcode?.solved} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">By topic</h3>
              <LeetCodeTopics byTopic={leetcode?.byTopic} />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }
  ```

- [ ] **Step 3: Build + full test run.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: build `✓ Compiled successfully`; `Test Files 5 passed` (useProfile, app-sidebar, LanguageDistribution, ConnectionButton, DisconnectDialog). The route table lists `/profile` (dynamic, client). Confirm no static-rendering error from `useProfile` in a `"use client"` page (it is a client component, so OK).

- [ ] **Step 4: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "feat(profile): Layout A read-only consolidated profile page with GitHub viz + LeetCode placeholders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 9: Playwright happy-path — sidebar nav → Connect navigates to authorize

This extends the existing auth happy-path. Because the app requires a real backend session, the spec gates on auth: if unauthenticated it asserts the redirect to `/login`; the deep assertions run only when a session is present (env-flagged), so CI stays green without a backend.

**Files:**
- Create: `tests/connections.spec.ts`

- [ ] **Step 1: Write the Playwright spec.** Create `tests/connections.spec.ts`:
  ```ts
  import { test, expect } from "@playwright/test";

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  // Set RUN_AUTHED=1 (and have a live backend session) to run the deep flow.
  const AUTHED = process.env.RUN_AUTHED === "1";

  test("connections requires auth when logged out", async ({ page }) => {
    test.skip(AUTHED, "authed run covers the deep flow instead");
    await page.goto("/connections");
    await expect(page).toHaveURL(/\/login/);
  });

  test("authed: sidebar → connections → Connect navigates to authorize", async ({ page }) => {
    test.skip(!AUTHED, "requires a live backend session; set RUN_AUTHED=1");

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Connections" }).click();
    await expect(page).toHaveURL(/\/connections/);

    // The Connect button is a real anchor-like navigation to the backend.
    // Intercept the top-level navigation to assert the target without leaving.
    const connect = page.getByRole("button", { name: /connect github/i });
    await expect(connect).toBeVisible();

    await page.route("**/api/v1/connections/github/authorize", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );
    const [request] = await Promise.all([
      page.waitForRequest(`${API_URL}/api/v1/connections/github/authorize`),
      connect.click(),
    ]);
    expect(request.url()).toBe(`${API_URL}/api/v1/connections/github/authorize`);
  });
  ```

- [ ] **Step 2: Run the logged-out spec (no backend needed).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx playwright test tests/connections.spec.ts --reporter=line
  ```
  Expected: the "requires auth when logged out" test PASSES (redirect to `/login`); the authed test reports `skipped`. If Playwright browsers aren't installed, run `npx playwright install chromium` first.

- [ ] **Step 3: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "test(e2e): connections auth gate + authed connect-navigates-to-authorize happy path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 10: Final verification sweep + no-scoring audit

**Files:** none (verification only).

- [ ] **Step 1: Full production build.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`, exit 0, route table includes `/dashboard`, `/profile`, `/connections`.

- [ ] **Step 2: Full unit/component test run.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test
  ```
  Expected: `Test Files 5 passed` (useProfile, app-sidebar, LanguageDistribution, ConnectionButton, DisconnectDialog), no failures.

- [ ] **Step 3: Lint.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run lint
  ```
  Expected: exit 0 (no errors). Fix any unused-import / `any` warnings in the new files.

- [ ] **Step 4: No-scoring audit (CLAUDE.md hard rule).** Grep all new/modified UI for forbidden comparative vocabulary:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && grep -rniE "\b(score|ranking|ranked|rank|grade|percentile|tier|better than|above average|leaderboard rank)\b" app/\(app\)/profile app/\(app\)/connections components/visualizations features/profile || echo "PASS: no scoring/ranking vocabulary in profile/connections UI"
  ```
  Expected: `PASS: no scoring/ranking vocabulary…`. (`ROUTES.leaderboard` is unrelated and not referenced here.) If any match appears in our files, remove the wording — Profile Builder is purely descriptive.

- [ ] **Step 5: Confirm forbidden deps never crept in.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && ! grep -qE '"@dnd-kit|@tanstack/react-table' package.json && echo "PASS: no dnd-kit / react-table"
  ```
  Expected: `PASS: no dnd-kit / react-table`.

- [ ] **Step 6: Verify the lockfile is consistent after `--legacy-peer-deps` installs.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm ci --legacy-peer-deps --dry-run >/dev/null 2>&1 && echo "PASS: lockfile resolves" || echo "FAIL: lockfile drift — run npm install --legacy-peer-deps and recommit"
  ```
  Expected: `PASS: lockfile resolves`.

- [ ] **Step 7: Final commit (if Steps 3–4 required fixes).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "chore: lint fixes + verification sweep for profile builder frontend slice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
  ```

- [ ] **Step 8: Push the branch (only if the user asks).** Do not push automatically. When requested:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git push -u origin feat/profile-builder-frontend
  ```