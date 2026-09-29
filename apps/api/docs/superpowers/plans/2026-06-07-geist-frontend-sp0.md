# Geist Frontend Revamp SP-0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a reusable Geist "foundation kit" of composition components under `components/patterns/`, then redesign every currently-live surface (marketing home, auth/login/callback, app shell, dashboard, profile, connections) to a pure-monochrome Geist look on top of that kit — changing layout and visuals ONLY, never data fetching, auth, routing, or the `ProfileResponse` contract.

**Architecture:** Next.js 16 App Router (React 19, Server Components by default), Tailwind 3.4 with neutral CSS-variable tokens already defined in `app/globals.css` (no palette change in this slice), shadcn "new-york" primitives under `components/ui/`, Geist Sans (`font-sans`) + Geist Mono (`font-mono`) wired in `app/layout.tsx`. Data comes from `useProfile()` (TanStack Query → `apiFetch` → `GET /api/v1/profile/me`) and `useAuth()` (in-memory access token, silent refresh). The kit is route-agnostic; surfaces import it via the barrel `@/components/patterns`.

**Tech Stack:** TypeScript, Tailwind 3.4.19, shadcn (classic CLI `shadcn@2.10.0`), lucide-react icons, recharts (grayscale charts), Vitest 2 + Testing Library + jsdom (`npm run test` = `vitest run`), `npm run build` = `next build` (integration gate). `cn` lives at `@/lib/utils/cn`; `ROUTES` at `@/lib/constants/routes`; `apiFetch` at `@/lib/api-client/client`; `useAuth` at `@/lib/auth/AuthProvider`; `useProfile` + profile types at `@/features/profile`.

**Hard constraints (do not violate):**
- PURE MONOCHROME Geist: only the neutral token scale (`background`/`foreground`/`muted`/`border`/`card`/`primary` = near-black/white). NO blue accent anywhere. Charts grayscale (`--chart-1..5`; `LeetCodeDifficulty` keeps its `--color-lc-*` tokens as the single allowed exception — it is descriptive difficulty color, not a chart accent). Status semantics limited to tiny green/red/amber dots, never fills.
- Geist Sans for UI; `font-mono` for ALL numerals, IDs, percentages, hashes, data badges.
- Layout/visual ONLY. Do NOT touch data fetching, auth, routing, the `ProfileResponse` contract, or component logic/wiring. Keep existing tests green; update selectors only if your markup legitimately changes them.
- NO scoring / ranking / grade / percentile / "above average" language anywhere.
- Use existing shadcn primitives + the kit; hairline borders (`border-border`, 1px); dark-first (light comes from tokens).
- We are already on branch `feat/github-profile-builder-frontend`. Do NOT create a branch.
- Do NOT wrap in-app page content in a `<main>` element. `components/ui/sidebar.tsx` `SidebarInset` already renders a `<main>` landmark, so the dashboard/profile/connections pages MUST use `<div>` (a nested `<main>` is invalid and was fixed earlier). The single required `<main>` (spec §1 a11y) is satisfied by SidebarInset.
- Commit trailer on EVERY commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Working directory for ALL commands:** `/Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend`

---

## File Structure

| Path | Action | Task |
|---|---|---|
| `components/ui/{table,label,form,scroll-area}.tsx` | Create (shadcn classic CLI) | 0 |
| `components/patterns/PageHeader.tsx` | Create | 1 |
| `components/patterns/Section.tsx` (exports `Section` + `SectionLabel`) | Create | 1 |
| `components/patterns/StatTile.tsx` (exports `StatTile` + `StatRow`) | Create | 1 |
| `components/patterns/EmptyState.tsx` | Create | 1 |
| `components/patterns/FormField.tsx` | Create | 1 |
| `components/patterns/Skeletons.tsx` (exports `ProfileSkeleton` + `ConnectionsSkeleton` + `DashboardSkeleton`) | Create | 1 |
| `components/patterns/DataTablePattern.tsx` | Create | 1 |
| `components/patterns/index.ts` | Create (barrel) | 1 |
| `components/patterns/EmptyState.test.tsx` | Create | 1 |
| `components/patterns/FormField.test.tsx` | Create | 1 |
| `components/patterns/StatTile.test.tsx` | Create | 1 |
| `app/(marketing)/layout.tsx` | Redesign | 2 |
| `app/(marketing)/page.tsx` | Redesign | 2 |
| `app/(auth)/layout.tsx` | Redesign | 3 |
| `app/(auth)/login/page.tsx` | Redesign (keep Suspense + useAuth wiring) | 3 |
| `app/auth/callback/page.tsx` | Redesign (spinner only) | 3 |
| `components/app-sidebar.tsx` | Polish | 4 |
| `components/site-header.tsx` | Polish (title + actions slot via context) | 4 |
| `components/nav-main.tsx` | Polish (active inset) | 4 |
| `components/nav-user.tsx` | Polish (keep useProfile + useAuth().logout) | 4 |
| `app/(app)/layout.tsx` | Keep RequireAuth + SidebarProvider (no logic change) | 4 |
| `app/(app)/dashboard/page.tsx` | Redesign (welcome / next-steps) | 5 |
| `app/(app)/profile/page.tsx` | Re-craft (Layout A on kit) | 6 |
| `app/(app)/profile/_components/AtAGlance.tsx` | Re-craft | 6 |
| `components/visualizations/ContributionHeatmap.tsx` | Re-craft (grayscale bins) | 6 |
| `components/visualizations/GithubStatTiles.tsx` | Re-craft (use StatRow/StatTile) | 6 |
| `app/(app)/connections/page.tsx` | Polish (PageHeader) | 7 |
| `app/(app)/connections/_components/ProviderCard.tsx` | Polish (state machine + last-refreshed + error) | 7 |
| `app/(app)/connections/_components/ConnectionsGrid.tsx` | Polish (ConnectionsSkeleton + EmptyState) | 7 |
| `app/(app)/connections/_components/ConnectionStatus.tsx` | Polish (dot variant) | 7 |
| `*.test.tsx` (existing) | Keep green; update selectors only if markup change requires | all |

**Existing tests that MUST stay green:** `components/app-sidebar.test.tsx`, `components/visualizations/LanguageDistribution.test.tsx`, `features/profile/hooks/useProfile.test.tsx`, `app/(app)/connections/_components/ConnectionButton.test.tsx`, `app/(app)/connections/_components/DisconnectDialog.test.tsx`.

---

## Task 0: Baseline green + add missing shadcn primitives

**Goal:** Confirm the repo builds and tests pass before any change, then add the missing shadcn primitives (`table`, `label`, `form`, `scroll-area`) the kit will use. `input` already exists at `components/ui/input.tsx` — re-add with `--overwrite` is harmless but optional; the four below are the genuinely missing ones.

- [ ] **0.1** Confirm we are on the right branch (do NOT create one). Run:
  ```
  git -C /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend branch --show-current
  ```
  Expected output: `feat/github-profile-builder-frontend`. If it differs, STOP and ask.

- [ ] **0.2** Baseline build:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: ends with `✓ Compiled successfully` (Next.js prints route table; no TS/Tailwind errors).

- [ ] **0.3** Baseline test:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test
  ```
  Expected: all 5 existing test files pass (`app-sidebar`, `LanguageDistribution`, `useProfile`, `ConnectionButton`, `DisconnectDialog`). Note the exact passing count so you can detect regressions later.

- [ ] **0.4** Add the four missing primitives via the classic CLI (run each; accept the prompt with the piped newlines):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && printf '\n\n' | npm_config_legacy_peer_deps=true npx --yes shadcn@2.10.0 add table --overwrite
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && printf '\n\n' | npm_config_legacy_peer_deps=true npx --yes shadcn@2.10.0 add label --overwrite
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && printf '\n\n' | npm_config_legacy_peer_deps=true npx --yes shadcn@2.10.0 add form --overwrite
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && printf '\n\n' | npm_config_legacy_peer_deps=true npx --yes shadcn@2.10.0 add scroll-area --overwrite
  ```
  Expected: each prints something like `Created 1 file: components/ui/<name>.tsx` (form may also add `label`; that's fine). label/form pull in `@radix-ui/react-label` and scroll-area pulls in `@radix-ui/react-scroll-area`; the shadcn CLI auto-installs them. If a build error reports either missing, run: `npm_config_legacy_peer_deps=true npm install @radix-ui/react-label @radix-ui/react-scroll-area` then rebuild.

- [ ] **0.5** Verify the files exist:
  ```
  ls /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/ui/table.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/ui/label.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/ui/form.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/ui/scroll-area.tsx
  ```
  Expected: all four paths listed, no "No such file".

- [ ] **0.6** Re-build to confirm the new primitives compile:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`. If `radix-ui/react-scroll-area` is missing as a dependency, run `npm_config_legacy_peer_deps=true npm install @radix-ui/react-scroll-area` then rebuild.

- [ ] **0.7** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add components/ui package.json package-lock.json && git commit -m "chore(ui): add table, label, form, scroll-area shadcn primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **0.8** Neutralize the blue `--chart-3` token (pure monochrome). Edit `app/globals.css`:
  - In the `:root` block, change `--chart-3: 212 100% 48%;` to `--chart-3: 0 0% 27%;`
  - In the `.dark` block, change `--chart-3: 212 100% 60%;` to `--chart-3: 0 0% 50%;`

  Rationale: LanguageDistribution cycles `--chart-1..5`; `chart-3` was the lone blue, which would render a blue pie slice — neutralize it WITHOUT touching the component (its test stays green).

  Then rebuild to confirm:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `Compiled successfully`.

  Commit:
  ```
  git add app/globals.css && git commit -m "fix(ui): neutralize blue --chart-3 token for pure-monochrome charts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 1: Foundation kit (`components/patterns/`)

**Goal:** Create every kit component with COMPLETE TSX matching the pinned KIT APIs exactly, a barrel that re-exports all, and Vitest+RTL tests (TDD) for the three pieces with real logic: `EmptyState` (renders title/hint/action + fires action), `FormField` (shows error), `StatTile` (renders mono value). Pure-presentation pieces (`PageHeader`, `Section`/`SectionLabel`, `StatRow`, Skeletons, `DataTablePattern`) get no behavior test — they are covered by the build gate and by surface usage.

> TDD order for the three tested components: write the failing test → run it (RED) → implement → run (GREEN) → move on. Implement the untested presentational components alongside so the barrel compiles.

### 1.1 — RED: write the three behavior tests first

- [ ] **1.1a** Create `components/patterns/EmptyState.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title, hint and an action, and fires the action on click", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No connections yet"
        hint="Connect a source to build your profile."
        action={
          <button type="button" onClick={onClick}>
            Connect GitHub
          </button>
        }
      />,
    );

    expect(screen.getByText("No connections yet")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a source to build your profile."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /connect github/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders without a hint or action", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **1.1b** Create `components/patterns/FormField.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("renders the label and the control slot", () => {
    render(
      <FormField label="Email">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("email-input")).toBeInTheDocument();
  });

  it("shows the error message and not the hint when error is set", () => {
    render(
      <FormField label="Email" hint="We never share it" error="Required">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByText("We never share it")).not.toBeInTheDocument();
  });

  it("shows the hint when there is no error", () => {
    render(
      <FormField label="Email" hint="We never share it">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("We never share it")).toBeInTheDocument();
  });
});
```

- [ ] **1.1c** Create `components/patterns/StatTile.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("renders the value in a font-mono element and the label", () => {
    render(<StatTile value="1,204" label="Contributions" />);
    const value = screen.getByText("1,204");
    expect(value).toBeInTheDocument();
    expect(value.className).toMatch(/font-mono/);
    expect(screen.getByText("Contributions")).toBeInTheDocument();
  });

  it("contains no scoring or ranking language", () => {
    const { container } = render(<StatTile value="38" label="Public repos" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/score|rank|grade|percentile|above average/i);
  });
});
```

- [ ] **1.1d** Run the three (expect RED — modules don't exist yet):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx vitest run components/patterns
  ```
  Expected: failures with "Failed to resolve import './EmptyState'" etc. This confirms the tests run.

### 1.2 — GREEN: implement the kit

- [ ] **1.2a** Create `components/patterns/PageHeader.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Consistent page top: an <h1> title with optional muted description and an
 * optional right-aligned actions slot. Geist Sans, tight tracking.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
```

- [ ] **1.2b** Create `components/patterns/Section.tsx` (exports both `Section` and `SectionLabel`):
```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Uppercase Geist Mono ~11px muted label that heads a Section. */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

export interface SectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Content block with hairline top separation and an optional uppercase mono
 * label. Use to group related panels under a quiet heading.
 */
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-4 border-t border-border pt-6", className)}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      {children}
    </section>
  );
}
```

- [ ] **1.2c** Create `components/patterns/StatTile.tsx` (exports `StatTile` + `StatRow`). Note: Spec §2 listed a `mono?` prop; intentionally dropped — StatTile value is unconditionally font-mono per the type rule.
```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface StatTileProps {
  value: React.ReactNode;
  label: string;
  className?: string;
}

/**
 * A single KPI: large Geist Mono value over a muted label. Descriptive only —
 * never a score, rank, or comparison.
 */
export function StatTile({ value, label, className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-1 px-5 py-4", className)}>
      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export interface StatRowProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Hairline-divided grid of StatTiles. Wraps the row in a card-bordered
 * container; vertical dividers between tiles via `divide-x`.
 */
export function StatRow({ children, className }: StatRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **1.2d** Create `components/patterns/EmptyState.tsx`:
```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Not-connected / no-data state: centered icon, title, muted hint, optional
 * action slot. Hairline-dashed card.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-muted-foreground [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint ? (
          <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
```

- [ ] **1.2e** Create `components/patterns/FormField.tsx`:
```tsx
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Label + control slot + hint/error. Pairs with react-hook-form + zod. When an
 * error is present it replaces the hint and is styled destructive.
 */
export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **1.2f** Create `components/patterns/Skeletons.tsx` (exports the three compositions; uses the existing shadcn `Skeleton`):
```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Loading composition for the Profile surface. */
export function ProfileSkeleton() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Loading composition for the Connections grid. */
export function ConnectionsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Loading composition for the Dashboard welcome page. */
export function DashboardSkeleton() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
```

- [ ] **1.2g** Create `components/patterns/DataTablePattern.tsx` (thin styled wrapper over shadcn `table`, built now for later list/admin surfaces):
```tsx
import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";

export interface DataTableColumn<T> {
  /** Header text. */
  header: string;
  /** Cell renderer for a row. */
  cell: (row: T) => React.ReactNode;
  /** Optional className applied to both header and body cells (e.g. mono/right-align). */
  className?: string;
}

export interface DataTablePatternProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable key per row. */
  rowKey: (row: T) => string;
  /** Rendered when `rows` is empty. */
  empty?: React.ReactNode;
  className?: string;
}

/**
 * Hairline-bordered table wrapper. Numeric/ID columns should pass
 * `className="font-mono tabular-nums"`. Presentation only.
 */
export function DataTablePattern<T>({
  columns,
  rows,
  rowKey,
  empty,
  className,
}: DataTablePatternProps<T>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.header} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                {empty ?? "No data."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((col) => (
                  <TableCell key={col.header} className={col.className}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **1.2h** Create the barrel `components/patterns/index.ts`:
```ts
export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";

export { Section, SectionLabel } from "./Section";
export type { SectionProps, SectionLabelProps } from "./Section";

export { StatTile, StatRow } from "./StatTile";
export type { StatTileProps, StatRowProps } from "./StatTile";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { FormField } from "./FormField";
export type { FormFieldProps } from "./FormField";

export { ProfileSkeleton, ConnectionsSkeleton, DashboardSkeleton } from "./Skeletons";

export { DataTablePattern } from "./DataTablePattern";
export type { DataTablePatternProps, DataTableColumn } from "./DataTablePattern";
```

- [ ] **1.2i** Run the kit tests (expect GREEN):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx vitest run components/patterns
  ```
  Expected: 3 files pass (EmptyState 2, FormField 3, StatTile 2 = 7 tests).

- [ ] **1.2j** Build to confirm the whole barrel + DataTablePattern generics compile:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`.

- [ ] **1.3** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add components/patterns && git commit -m "feat(patterns): add Geist foundation kit (PageHeader, Section, StatTile, EmptyState, FormField, Skeletons, DataTablePattern)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: Marketing shell + home redesign

**Goal:** Editorial monochrome marketing shell — sticky hairline header (brand + nav + Sign in) and a minimal footer — and an editorial home page (mono eyebrow, large tight headline, muted subhead, primary CTA → `/login`, secondary → pricing, value-prop row). No data, no auth, no new routes. Pure styling → build + visual check (no unit test).

- [ ] **2.1** Replace `app/(marketing)/layout.tsx` entirely:
```tsx
import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <Link
            href={ROUTES.home}
            className="font-semibold tracking-tight text-foreground"
          >
            InterviewIQ
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href={ROUTES.pricing}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              href={ROUTES.forColleges}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              For colleges
            </Link>
            <Link
              href={ROUTES.login}
              className="ml-2 rounded-md border border-border bg-primary px-3.5 py-1.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row">
          <span className="font-mono">InterviewIQ © 2026</span>
          <nav className="flex items-center gap-4">
            <Link
              href={ROUTES.about}
              className="transition-colors hover:text-foreground"
            >
              About
            </Link>
            <Link
              href={ROUTES.contact}
              className="transition-colors hover:text-foreground"
            >
              Contact
            </Link>
            <Link
              href={ROUTES.pricing}
              className="transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **2.2** Replace `app/(marketing)/page.tsx` entirely:
```tsx
import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

const VALUE_PROPS = [
  {
    title: "Voice-driven mock interviews",
    body: "A personalized AI interviewer conducts role- and company-specific loops, end to end.",
  },
  {
    title: "Full candidate context",
    body: "Connect GitHub, your résumé and coding profiles so every question fits who you are.",
  },
  {
    title: "Structured feedback",
    body: "Get a descriptive debrief after each session — what you showed, in your own data.",
  },
];

export default function MarketingHomePage() {
  return (
    <main className="relative">
      {/* Subtle dot-grid background, monochrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.4] [background-image:radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]"
      />

      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:py-32">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          AI-powered mock interviews
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
          Practice interviews that feel real.
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
          Unlimited, role-specific, voice-based mock interviews with a
          personalized AI interviewer — built for your next placement.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href={ROUTES.login}
            className="rounded-md border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href={ROUTES.pricing}
            className="rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            View pricing
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:pb-32">
        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {VALUE_PROPS.map((vp) => (
            <div key={vp.title} className="bg-card p-6">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {vp.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{vp.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **2.3** Build:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`.

- [ ] **2.4** Visual check (defer to Task 8 dev-server pass, but spot-check now): `npm run dev`, open `http://localhost:3000/` in both dark and light — hero centered, dot grid subtle, value-prop row hairline-divided, footer hairline. No blue. Stop the dev server.

- [ ] **2.5** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add "app/(marketing)" && git commit -m "feat(marketing): monochrome Geist shell + editorial home

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: Auth shell + login + callback redesign

**Goal:** Centered Geist card auth shell with a brand mark; login redesigned to a monochrome Google button (keep the existing Suspense + `useAuth` + `?error=` wiring EXACTLY); callback = refined centered spinner. Do NOT touch any auth logic, redirects, or the Google flow.

- [ ] **3.1** Replace `app/(auth)/layout.tsx` entirely (centered card shell with brand mark above the slot):
```tsx
import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link
            href={ROUTES.home}
            className="font-semibold tracking-tight text-foreground"
          >
            InterviewIQ
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}
```

- [ ] **3.2** Replace `app/(auth)/login/page.tsx` entirely. KEEP the `Suspense` wrapper, `LoginContent`, `useAuth()` (`status`, `login`), the authenticated redirect, and `?error=` handling byte-for-byte in behavior — only the markup/classes change. Monochrome Google button: render the Google glyph in current/foreground tone (no brand colors) to honor the pure-monochrome rule.
```tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/routes";

export default function LoginPage() {
  return (
    <Suspense fallback={<section className="w-full" />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, login } = useAuth();

  // Already signed in → bounce to the app.
  useEffect(() => {
    if (status === "authenticated") {
      router.replace(ROUTES.dashboard);
    }
  }, [status, router]);

  const error = params.get("error");

  return (
    <section className="w-full">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Sign in to InterviewIQ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Practice interviews with an AI interviewer.
          </p>
        </div>

        {error ? (
          <p className="mb-4 flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
            />
            Sign-in failed. Please try again.
          </p>
        ) : null}

        <button
          type="button"
          onClick={login}
          disabled={status === "loading"}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleGlyph />
          Continue with Google
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </section>
  );
}

/** Monochrome Google "G" — inherits the button's currentColor (no brand hues). */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
      <path d="M12 11v2.8h3.97c-.16 1.03-1.18 3.02-3.97 3.02-2.39 0-4.34-1.98-4.34-4.42S9.61 7.98 12 7.98c1.36 0 2.27.58 2.79 1.08l1.9-1.83C15.47 6.09 13.9 5.4 12 5.4 8.13 5.4 5 8.53 5 12.4s3.13 7 7 7c4.04 0 6.72-2.84 6.72-6.84 0-.46-.05-.81-.11-1.16H12Z" />
    </svg>
  );
}
```

- [ ] **3.3** Replace `app/auth/callback/page.tsx` entirely. KEEP all routing logic (`status` → next/dashboard or `/login?error=oauth`) identical; only refine the spinner copy/spacing.
```tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/routes";

/**
 * OAuth landing page. The backend redirects here after setting the httpOnly
 * refresh-token cookie. AuthProvider (mounted at the root) runs a silent
 * refresh on mount, which consumes that cookie. We just wait for the resulting
 * auth status and route accordingly.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackSpinner />}>
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : ROUTES.dashboard);
    } else if (status === "unauthenticated") {
      router.replace(`${ROUTES.login}?error=oauth`);
    }
  }, [status, params, router]);

  return <CallbackSpinner />;
}

function CallbackSpinner() {
  return (
    <main className="flex min-h-[60vh] flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
        <p className="font-mono text-xs uppercase tracking-[0.08em]">
          Signing you in…
        </p>
      </div>
    </main>
  );
}
```

- [ ] **3.4** Build + run the full test suite (no auth tests exist, but confirm nothing regressed):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: `✓ Compiled successfully` and all tests pass.

- [ ] **3.5** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add "app/(auth)" app/auth && git commit -m "feat(auth): centered Geist card shell, monochrome Google button, refined callback spinner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: App shell polish

**Goal:** Polish the sidebar/header/nav VISUALS only. Keep `(app)/layout.tsx` (RequireAuth + SidebarProvider) unchanged. Keep `nav-user` bound to `useProfile` + `useAuth().logout`. The existing `components/app-sidebar.test.tsx` asserts (a) three nav links by role/name with hrefs `/dashboard`, `/profile`, `/connections`, and (b) NavUser shows the profile name "Aisha Verma" — preserve those exact link names and the name binding. The `site-header` gets an optional actions slot via a tiny context (page surfaces can set header actions later; default = none).

> **Nested-main guard:** Do NOT wrap in-app page content in a `<main>` element. `components/ui/sidebar.tsx` `SidebarInset` already renders a `<main>` landmark, so the dashboard/profile/connections pages MUST use `<div>` (a nested `<main>` is invalid and was fixed earlier). The single required `<main>` (spec §1 a11y) is satisfied by SidebarInset.

- [ ] **4.1** Polish `components/nav-main.tsx` — keep `NavItem`, `usePathname`, `active` logic and `aria-current` exactly; add a subtle mono-tinged active inset via class only:
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
import { cn } from "@/lib/utils/cn";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-1">
        <SidebarMenu>
          {items.map((item) => {
            const active =
              pathname === item.url || pathname.startsWith(`${item.url}/`);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.title}
                  className={cn(
                    active &&
                      "ring-1 ring-inset ring-sidebar-border data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium",
                  )}
                >
                  <Link
                    href={item.url}
                    aria-current={active ? "page" : undefined}
                  >
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

- [ ] **4.2** Polish `components/app-sidebar.tsx` — keep the nav arrays, `NavMain`/`NavSecondary`/`NavUser` wiring and `ROUTES`; only refine the brand header (keep the `Sparkles` icon + "InterviewIQ" text so the brand link still resolves) and add a hairline under the header:
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
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href={ROUTES.dashboard}>
                <Sparkles className="!size-5" />
                <span className="text-base font-semibold tracking-tight">
                  InterviewIQ
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **4.3** Polish `components/nav-user.tsx` — keep `useAuth().logout`, `useProfile()`, router, name/avatar/initials derivation, and the logout handler EXACTLY; only refine the dropdown label (show name in mono-tight) and keep the visible name binding (`{name}` rendered in the trigger) so `app-sidebar.test.tsx` still finds "Aisha Verma":
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
                <AvatarFallback className="rounded-lg font-mono text-xs">
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

- [ ] **4.4** Polish `components/site-header.tsx` — keep `usePathname`, the `TITLES` map and `titleFor`; add an OPTIONAL actions slot. To avoid changing the layout's children, expose actions via a lightweight context provider; default = nothing rendered (server pages that want actions can wrap themselves, but no surface in SP-0 sets them — the slot just exists). Keep the existing `<h1>` so nothing breaks:
```tsx
"use client";

import * as React from "react";
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

/** Optional right-aligned header actions. Surfaces may set this via the setter. */
const HeaderActionsContext = React.createContext<React.ReactNode>(null);

export function HeaderActions({ children }: { children: React.ReactNode }) {
  return (
    <HeaderActionsContext.Provider value={children}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="flex h-[--header-height] shrink-0 items-center gap-2 border-b border-border transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium tracking-tight">
          {titleFor(pathname)}
        </h1>
        <div className="ml-auto flex items-center gap-2" />
      </div>
    </header>
  );
}
```

- [ ] **4.5** Confirm `app/(app)/layout.tsx` is UNCHANGED (RequireAuth + SidebarProvider + AppSidebar + SiteHeader). Do not edit it.

- [ ] **4.6** Run the sidebar test specifically, then the full build:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx vitest run components/app-sidebar.test.tsx
  ```
  Expected: 2 tests pass (links + name binding). Then:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`.

- [ ] **4.7** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add components/app-sidebar.tsx components/site-header.tsx components/nav-main.tsx components/nav-user.tsx && git commit -m "feat(shell): polish sidebar active inset, brand header, nav-user, header actions slot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: Dashboard — welcome / next-steps

**Goal:** Replace the placeholder dashboard with a clean Geist welcome page: greeting (from `useProfile().data.user.name`), a `StatRow` of source counts derived ONLY from `data.sources` (connected count / total sources — no invented metrics, no scoring), and connect/complete-profile CTAs to `/connections` and `/profile`. Client component because `useProfile` is a hook. Show `DashboardSkeleton` while loading.

- [ ] **5.1** Replace `app/(app)/dashboard/page.tsx` entirely:
```tsx
"use client";

import Link from "next/link";
import { useProfile } from "@/features/profile";
import { ROUTES } from "@/lib/constants/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageHeader,
  StatRow,
  StatTile,
  DashboardSkeleton,
} from "@/components/patterns";

export default function DashboardPage() {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="flex-1 p-6">
        <p role="alert" className="text-sm text-destructive">
          Could not load your dashboard. Please refresh the page.
        </p>
      </div>
    );
  }

  const firstName = data.user.name?.split(" ")[0] ?? "there";
  const totalSources = data.sources.length;
  const connectedCount = data.sources.filter((s) => s.connected).length;
  const githubConnected = data.sources.some(
    (s) => s.source === "GITHUB" && s.connected,
  );

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your interview prep starts with a complete profile."
        actions={
          <Button asChild>
            <Link href={ROUTES.connections}>Connect a source</Link>
          </Button>
        }
      />

      <StatRow>
        <StatTile value={connectedCount} label="Sources connected" />
        <StatTile value={totalSources} label="Sources available" />
        <StatTile value={data.mostUsedSkills.length} label="Skills detected" />
        <StatTile value={data.notable.length} label="Notable items" />
      </StatRow>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
          <CardDescription>
            Connect your accounts so your profile reflects your real work.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          {!githubConnected ? (
            <Button asChild variant="outline">
              <Link href={ROUTES.connections}>Connect GitHub</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={ROUTES.profile}>View your profile</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **5.2** Build + test:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: `✓ Compiled successfully` and all tests pass (no dashboard tests; nothing else should change).

- [ ] **5.3** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add "app/(app)/dashboard" && git commit -m "feat(dashboard): welcome/next-steps page on the kit (StatRow from source counts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6: Profile re-craft (Layout A on the kit)

**Goal:** Re-craft the profile surface on the kit — `PageHeader` (name + headline + Manage-connections action), `StatTile`/`StatRow` for GitHub stats, grayscale `LanguageDistribution` (already grayscale via `--chart-*`), grayscale `ContributionHeatmap` (CONVERT emerald bins → neutral bins), LeetCode charts, hairline `Section` dividers, and the re-crafted `AtAGlance` band. Keep `useProfile` wiring, the `githubConnected` logic, the LeetCode block, and the no-scoring rule. `ProfileSkeleton` for loading. The `LanguageDistribution.test.tsx` and `useProfile.test.tsx` MUST stay green — neither touches the files edited here except `LanguageDistribution` (which we do NOT modify).

- [ ] **6.1** Re-craft `components/visualizations/ContributionHeatmap.tsx` — KEEP `bin()`, props, `role="img"` + aria, and the legend; CONVERT the emerald `BIN_CLASS` to a neutral grayscale ramp (monochrome rule). Numbers stay mono:
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

/** Grayscale intensity ramp (monochrome): muted → near-foreground. */
const BIN_CLASS = [
  "bg-muted",
  "bg-foreground/20",
  "bg-foreground/40",
  "bg-foreground/65",
  "bg-foreground/90",
];

export function ContributionHeatmap({
  weeks,
  totalLastYear,
}: ContributionHeatmapProps) {
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
        <span className="font-mono tabular-nums text-foreground">
          {totalLastYear.toLocaleString()}
        </span>{" "}
        contributions in the last year
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

- [ ] **6.2** Re-craft `components/visualizations/GithubStatTiles.tsx` to use the kit `StatRow`/`StatTile` (keeps the same data math; drops the per-tile mini-cards in favor of the hairline-divided row):
```tsx
import { StatRow, StatTile } from "@/components/patterns";
import type { GithubFragment } from "@/features/profile";

export function GithubStatTiles({ github }: { github: GithubFragment }) {
  const totalStars = github.topRepos.reduce((sum, r) => sum + r.stars, 0);

  return (
    <StatRow>
      <StatTile
        value={github.publicRepos.toLocaleString()}
        label="Public repos"
      />
      <StatTile
        value={github.externalPRs.toLocaleString()}
        label="External PRs"
      />
      <StatTile value={totalStars.toLocaleString()} label="Stars on top repos" />
      <StatTile value={String(github.joinedYear)} label="On GitHub since" />
    </StatRow>
  );
}
```

- [ ] **6.3** Re-craft `app/(app)/profile/_components/AtAGlance.tsx` — KEEP the `AtAGlanceProps` shape and all three data lists; restyle with `SectionLabel`, hairline panels, mono evidence. Skills evidence stays in mono (it carries percentages/IDs). No scoring language:
```tsx
import { SectionLabel } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { NotableItem, SkillItem } from "@/features/profile";

export interface AtAGlanceProps {
  atAGlance: string[];
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
}

export function AtAGlance({
  atAGlance,
  notable,
  mostUsedSkills,
}: AtAGlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-3">
        <CardContent className="space-y-3 p-6">
          <SectionLabel>At a glance</SectionLabel>
          {atAGlance.length ? (
            <ul className="space-y-1.5 text-sm">
              {atAGlance.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                  />
                  <span>{item}</span>
                </li>
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
        <CardContent className="space-y-3 p-6">
          <SectionLabel>Notable</SectionLabel>
          {notable.length ? (
            <ul className="space-y-2 text-sm">
              {notable.map((n, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>{n.text}</span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 font-mono text-[10px]"
                  >
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
        <CardContent className="space-y-3 p-6">
          <SectionLabel>Most-used skills</SectionLabel>
          {mostUsedSkills.length ? (
            <ul className="space-y-2 text-sm">
              {mostUsedSkills.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-medium">{s.skill}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.evidence}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No skills detected yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **6.4** Re-craft `app/(app)/profile/page.tsx` — KEEP `useProfile()`, the `github`/`leetcode`/`githubConnected` derivations, the AtAGlance + GitHub + LeetCode blocks and their conditionals; restyle with `PageHeader`, `Section` dividers, `ProfileSkeleton`. No scoring:
```tsx
"use client";

import Link from "next/link";
import { useProfile } from "@/features/profile";
import { ROUTES } from "@/lib/constants/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageHeader,
  Section,
  SectionLabel,
  ProfileSkeleton,
  EmptyState,
} from "@/components/patterns";
import { AtAGlance } from "./_components/AtAGlance";
import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";

export default function ProfilePage() {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="flex-1 p-6">
        <p role="alert" className="text-sm text-destructive">
          Could not load your profile. Please refresh the page.
        </p>
      </div>
    );
  }

  const github = data.fragments.github;
  const leetcode = data.fragments.leetcode;
  const githubConnected = data.sources.some(
    (s) => s.source === "GITHUB" && s.connected,
  );

  return (
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title={data.user.name ?? "Your profile"}
        description={data.user.headline ?? undefined}
        actions={
          <Button asChild variant="outline">
            <Link href={ROUTES.connections}>Manage connections</Link>
          </Button>
        }
      />

      <AtAGlance
        atAGlance={data.atAGlance}
        notable={data.notable}
        mostUsedSkills={data.mostUsedSkills}
      />

      <Section title="GitHub">
        {githubConnected && github ? (
          <div className="space-y-6">
            <GithubStatTiles github={github} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-3 p-6">
                  <SectionLabel>Languages</SectionLabel>
                  <LanguageDistribution languages={github.languages} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3 p-6">
                  <SectionLabel>Contributions</SectionLabel>
                  <ContributionHeatmap
                    weeks={github.contributions.weeks}
                    totalLastYear={github.contributions.lastYear}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <EmptyState
            title="GitHub not connected"
            hint="Connect GitHub to see your languages, repos and contributions."
            action={
              <Button asChild>
                <Link href={ROUTES.connections}>Connect</Link>
              </Button>
            }
          />
        )}
      </Section>

      <Section title="LeetCode">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-6">
              <SectionLabel>By difficulty</SectionLabel>
              <LeetCodeDifficulty solved={leetcode?.solved} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-6">
              <SectionLabel>By topic</SectionLabel>
              <LeetCodeTopics byTopic={leetcode?.byTopic} />
            </CardContent>
          </Card>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **6.5** Run the profile-adjacent tests then build:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx vitest run components/visualizations/LanguageDistribution.test.tsx features/profile/hooks/useProfile.test.tsx
  ```
  Expected: both pass. Then:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`.

- [ ] **6.6** No-scoring grep over the files touched here (must be empty):
  ```
  grep -rniE --include='*.tsx' --exclude='*.test.tsx' "score|ranking|\brank\b|grade|percentile|above average|better than|top [0-9]+%" /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/app/\(app\)/profile /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/visualizations
  ```
  Expected: no matches in non-test source (the only residual hits are anti-scoring assertions inside *.test.tsx, which is fine).

- [ ] **6.7** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add "app/(app)/profile" components/visualizations/ContributionHeatmap.tsx components/visualizations/GithubStatTiles.tsx && git commit -m "feat(profile): re-craft Layout A on the kit; grayscale heatmap; mono stats

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7: Connections polish

**Goal:** Polish the connections surface — `PageHeader` on the page, `ConnectionsSkeleton` + `EmptyState`-style messaging in the grid, a tightened `ProviderCard` state machine (not-connected / connected+last-refreshed / error) with status as a tiny semantic DOT (green/red) instead of a filled badge, and `?error=` surfacing preserved. KEEP `ConnectionButton.tsx` (its test asserts apiFetch→navigate) and `DisconnectDialog.tsx` (its test asserts the mutation success path) UNCHANGED. The grid still maps `data.sources` exactly as before.

- [ ] **7.1** Polish `app/(app)/connections/page.tsx` — KEEP the server component, `searchParams` await, and `errorToSource`; swap the hand-rolled header for `PageHeader`:
```tsx
import type { SourceKind } from "@/features/profile";
import { PageHeader } from "@/components/patterns";
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
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        title="Connections"
        description="Connect your accounts to build your profile. We only read public data."
      />
      <ConnectionsGrid errorSource={errorSource} />
    </div>
  );
}
```

- [ ] **7.2** Polish `app/(app)/connections/_components/ConnectionStatus.tsx` — render status as a tiny semantic dot + label (green = connected, red = error, neutral = not connected), per the monochrome-with-sparse-status rule. KEEP the `ConnectionState` type, `LABELS`, `role="status"`, and `aria-label`:
```tsx
import { cn } from "@/lib/utils/cn";

export type ConnectionState = "not-connected" | "connected" | "error";

const LABELS: Record<ConnectionState, string> = {
  "not-connected": "Not connected",
  connected: "Connected",
  error: "Error",
};

const DOT: Record<ConnectionState, string> = {
  "not-connected": "bg-muted-foreground/50",
  connected: "bg-green-500",
  error: "bg-destructive",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <span
      role="status"
      aria-label={`Connection status: ${LABELS[state]}`}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", DOT[state])}
      />
      {LABELS[state]}
    </span>
  );
}
```

- [ ] **7.3** Polish `app/(app)/connections/_components/ProviderCard.tsx` — KEEP `ProviderCardProps`, `deriveState`, `SHOW_REFRESH`, the connected/not-connected branching, and the `DisconnectDialog`/`ConnectionButton` usage; restyle the last-refreshed timestamp in mono, keep the error line, and use the dot status:
```tsx
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card className="flex flex-col">
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
      <CardContent className="mt-auto space-y-3">
        {connected && lastRefreshedAt ? (
          <p className="text-xs text-muted-foreground">
            Last refreshed{" "}
            <span className="font-mono tabular-nums">
              {new Date(lastRefreshedAt).toLocaleDateString()}
            </span>
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
            <ConnectionButton source={provider.source} label={provider.label} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **7.4** Polish `app/(app)/connections/_components/ConnectionsGrid.tsx` — KEEP `useProfile()`, the `byKind` map and the `PROVIDERS.map` rendering; swap the inline skeleton for `ConnectionsSkeleton` and add an `EmptyState` fallback if (defensively) `data.sources` is empty so no providers resolve. Keep `errorSource` plumbing:
```tsx
"use client";

import { Link2 } from "lucide-react";
import { ProviderCard } from "./ProviderCard";
import { PROVIDERS } from "./providers";
import { useProfile, type SourceKind } from "@/features/profile";
import { ConnectionsSkeleton, EmptyState } from "@/components/patterns";

export function ConnectionsGrid({ errorSource }: { errorSource?: SourceKind }) {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <ConnectionsSkeleton />;
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load your connections. Please refresh the page.
      </p>
    );
  }

  if (PROVIDERS.length === 0) {
    return (
      <EmptyState
        icon={<Link2 />}
        title="No sources available yet"
        hint="Connectable sources will appear here."
      />
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

- [ ] **7.5** Confirm `ConnectionButton.tsx` and `DisconnectDialog.tsx` are UNCHANGED. Run their tests:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npx vitest run "app/(app)/connections/_components/ConnectionButton.test.tsx" "app/(app)/connections/_components/DisconnectDialog.test.tsx"
  ```
  Expected: both pass. (If the shell glob is awkward in zsh, run `npx vitest run app` to scope to the app dir.)

- [ ] **7.6** Build + full test:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build && npm run test
  ```
  Expected: `✓ Compiled successfully` and all tests pass.

- [ ] **7.7** Commit:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add "app/(app)/connections" && git commit -m "feat(connections): PageHeader, dot status, mono last-refreshed, kit skeleton + empty state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 8: Final sweep

**Goal:** Whole-suite green, monochrome + no-scoring audits clean, manual dark+light visual pass on every redesigned surface.

- [ ] **8.1** Full build (integration gate):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run build
  ```
  Expected: `✓ Compiled successfully`.

- [ ] **8.2** Full test suite:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run test
  ```
  Expected: all test files pass — the 5 pre-existing (`app-sidebar`, `LanguageDistribution`, `useProfile`, `ConnectionButton`, `DisconnectDialog`) plus the 3 new kit tests (`EmptyState`, `FormField`, `StatTile`). No failures, no skipped regressions.

- [ ] **8.3** No-scoring grep over profile, connections, and visualizations (must be empty):
  ```
  grep -rniE --include='*.tsx' --exclude='*.test.tsx' "score|ranking|\brank\b|grade|percentile|above average|better than|top [0-9]+%" /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/app/\(app\)/profile /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/app/\(app\)/connections /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/visualizations
  ```
  Expected: no matches in non-test source (the only residual hits are anti-scoring assertions inside *.test.tsx, which is fine).

- [ ] **8.4** Blue-accent audit — confirm no stray blue utilities or `--chart-3` blue usage leaked into the redesigned surfaces (charts must read grayscale; `--chart-3` is still defined blue in tokens but `LanguageDistribution` cycles through chart-1..5 — acceptable per spec since we do not edit it, but verify no NEW blue class was introduced):
  ```
  grep -rniE "blue-|indigo-|sky-|cyan-|emerald|#4285F4|#34A853|text-blue|bg-blue" /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/app /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/patterns /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/visualizations /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/app-sidebar.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/site-header.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/nav-main.tsx /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend/components/nav-user.tsx
  ```
  Expected: no blue/indigo/sky/cyan/emerald matches. The only legitimate green/amber hits are the intentional status dots in `ConnectionStatus` (green/red connection-state dots) and the `LeetCodeDifficulty` `--color-lc-*` difficulty tokens — both allowed exceptions per the monochrome rule. (Also confirms the old multicolor Google SVG was replaced by the monochrome glyph and no blue classes were added.)

- [ ] **8.5** Manual visual check — start the dev server, toggle dark/light (theme switch lives in the app via `next-themes`; or set system theme), and walk every redesigned surface:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run dev
  ```
  Check, in BOTH dark and light:
  - `/` — hero centered, mono eyebrow, dot-grid subtle, value-prop row hairline-divided, sticky hairline header, minimal footer. No blue.
  - `/login` — centered card, brand mark above, monochrome Google button, terms caption; trigger `/login?error=oauth` and confirm the red-dot error line.
  - `/auth/callback` — refined centered spinner with mono "SIGNING YOU IN…" copy.
  - `/dashboard` — `PageHeader` greeting, hairline `StatRow` with mono numerals, next-steps card, connect CTAs.
  - `/profile` — `PageHeader` + Manage-connections action, AtAGlance band (mono evidence), GitHub `StatRow`, grayscale heatmap (no green) + language donut, hairline `Section` dividers, LeetCode charts. EmptyState if GitHub not connected.
  - `/connections` — `PageHeader`, provider cards with dot status (green connected / red error / neutral not-connected), mono last-refreshed date, `ConnectionsSkeleton` on load.
  Stop the dev server when done.

- [ ] **8.6** If `npm run lint` surfaces any auto-fixable issues from the new files, fix them:
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && npm run lint
  ```
  Expected: clean. Fix any errors (unused imports, etc.), then re-run build.

- [ ] **8.7** Final commit (only if 8.6 produced fixes; otherwise skip):
  ```
  cd /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend && git add -A && git commit -m "chore(sp0): lint fixes and final sweep for Geist revamp

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **8.8** Summary check: `git -C /Users/salescode/Desktop/project/interviewiq-frontend/interviewIQ-frontend log --oneline -9` should show the SP-0 commits in order (Task 0 → Task 7, plus an optional Task 8 fix commit), all on `feat/github-profile-builder-frontend`.