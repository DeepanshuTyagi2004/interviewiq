# HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the signed-in app + admin as a balanced mission-control HUD: HUD primitives, a redesigned ⌘K search, and 90% density, keeping the current rounded corners. Marketing, auth and onboarding must not change.

**Architecture:**
- Scope: a `useHudScope()` hook puts `iq-hud` on `<html>` while the app shell or admin layout is mounted. All scoped tokens (radius, zoom, HUD vars) and decorations hang off that class, plus a Tailwind `hud:` variant for components that also render outside the scope.
- Primitives live in `components/hud/`. Existing patterns become thin wrappers over them, then each section is swept.

**Tech Stack:** Next.js 16, React 19, Tailwind 3 (+ `tailwindcss/plugin`, already installed), shadcn/ui, lucide-react, Vitest + Testing Library, Playwright (visual check only).

**Spec:** `docs/superpowers/specs/2026-10-02-hud-redesign-design.md`

## Global Constraints

- **Out of scope stays identical.** Marketing, auth and onboarding are not restyled, zoomed or decorated.
- **Corners: unchanged (user decision during implementation).** Keep the working tree's rounder radii (cards/panels `rounded-[14px]`, dialogs/⌘K `rounded-[16px]`, shell `rounded-[18px]`, base `--radius` 10px). HUD primitives use `rounded-[14px]`. There is **no** radius sweep, no scoped `--radius`, no `rounded-shell`. The "radius map" lines in Tasks 1, 4 and 6–12 are void.
- **Notch:** an 18px 45° top-right cut, only on Up next, Readiness, Score tiles, Identity, and the ⌘K palette.
- **Colour:** orange `brand` is the only accent. No new hues. Token classes only, no raw hex (existing `#…` in `UpNextCard` gets replaced).
- **Honesty:** never invent telemetry. `StatusDot live` (pulse) only for really live/running states. `—` for missing scores. No count-ups or tickers. Readiness copy rules unchanged.
- **Motion:** 150ms `ease-iq` hovers. Pulse only for `live`. Everything off under `prefers-reduced-motion`.
- **Copy:** visible words unchanged except mono readout labels restating facts already on screen.
- **Dependencies:** no new runtime dependencies.
- **Git:** do **not** commit. Leave all changes in the working tree; the user commits themselves.
- **Live room:** the live interview room (`/interviews/[id]/live`, Monaco + Excalidraw) opts out of the zoom: `--hud-zoom: 1` there.

## Review Focus

1. **Leaving the app** (log out → `/login`, or the onboarding redirect) must drop `iq-hud`, or public pages render zoomed. Pinned in Task 1: `useHudScope` cleanup and refcount tests.
2. **Popovers, menus, tooltips, dialogs under `zoom: 0.9`** must open at their trigger. Pinned in Task 13: Playwright check of the account menu, notifications popover and ⌘K anchor positions.
3. **Live room editors:** clicks in Monaco/Excalidraw must land under the cursor. Pinned in Task 1: `HudZoomOff` sets/clears `data-hud-zoom="off"`. Task 13 checks the computed zoom is 1 on the live route.
4. **`SegmentMeter` with odd inputs** (`NaN`, negative, above max, fractions from `depthOf`) must render a valid fill. Pinned in Task 2: clamp tests.
5. **HudCard header at phone width (≈400px)** with long title + meta + action must wrap, not overflow. Pinned in Task 2: a `flex-wrap` class assertion. Task 13: a 400px screenshot.

---

## File map

| Path | Responsibility |
| --- | --- |
| `apps/web/app/globals.css` | scoped tokens (`html.iq-hud`), HUD decoration classes, zoom |
| `apps/web/tailwind.config.js` | `rounded-shell`, `hud:` variant |
| `apps/web/components/hud/scope.tsx` | `useHudScope`, `HudScope`, `HudZoomOff`, `HUD_CLASS` |
| `apps/web/components/hud/HudCard.tsx` | the one card frame + decorations + spotlight |
| `apps/web/components/hud/HudEmpty.tsx` | empty-body block |
| `apps/web/components/hud/Readout.tsx` | label/value readout |
| `apps/web/components/hud/SegmentMeter.tsx` | segmented meter + `clampFilled` |
| `apps/web/components/hud/StatusDot.tsx` | status dot + label |
| `apps/web/components/hud/Kbd.tsx` | keycap |
| `apps/web/components/hud/index.ts` | barrel |
| `components/patterns/*`, `components/ui/card.tsx`, `components/observability/ConsoleCard.tsx` | thin wrappers over hud |
| `components/layout/app-shell/*`, `components/layout/ThemeToggle.tsx` | shell, top bar, search, palette |
| `app/(app)/**`, `app/(admin)/**`, `components/visualizations/**`, `components/observability/**` | section sweeps |

---

### Task 1: Scope, tokens, zoom

**Files:**
- Create: `apps/web/components/hud/scope.tsx`, `apps/web/components/hud/scope.test.tsx`
- Modify: `apps/web/app/globals.css`, `apps/web/tailwind.config.js`, `apps/web/components/layout/app-shell/AppShell.tsx`, `apps/web/app/(admin)/layout.tsx`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveRoom.tsx`

**Interfaces:**
- Produces:
  - `HUD_CLASS = "iq-hud"`
  - `useHudScope(): void`
  - `HudScope(): null`
  - `HudZoomOff(): null`
  - CSS: `--radius` (6px in scope), `--radius-shell`, `--hud-zoom`, `--hud-tick`, `--hud-grid`, `--hud-glow`
  - Tailwind: `rounded-shell`, `hud:` variant

- [ ] **Step 1: Write the failing test** (`components/hud/scope.test.tsx`)

```tsx
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HUD_CLASS, HudScope, HudZoomOff } from "./scope";

const html = () => document.documentElement;

afterEach(() => {
  html().classList.remove(HUD_CLASS);
  html().removeAttribute("data-hud-zoom");
});

describe("HudScope", () => {
  it("adds iq-hud to <html> while mounted and removes it on unmount", () => {
    const { unmount } = render(<HudScope />);
    expect(html().classList.contains(HUD_CLASS)).toBe(true);
    unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(false);
  });

  it("keeps the class until the last of two scopes unmounts", () => {
    const a = render(<HudScope />);
    const b = render(<HudScope />);
    a.unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(true);
    b.unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(false);
  });
});

describe("HudZoomOff", () => {
  it("sets data-hud-zoom=off while mounted", () => {
    const { unmount } = render(<HudZoomOff />);
    expect(html().getAttribute("data-hud-zoom")).toBe("off");
    unmount();
    expect(html().hasAttribute("data-hud-zoom")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it.** `pnpm --filter @interviewiq/web exec vitest run components/hud/scope.test.tsx`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `components/hud/scope.tsx`**

```tsx
"use client";

import { useEffect } from "react";

/** Class on <html> that switches on the HUD look (tokens, zoom, decorations). */
export const HUD_CLASS = "iq-hud";

let scopes = 0;

/**
 * Puts the HUD class on <html> while the calling layout is mounted. On <html> rather than a
 * wrapper so Radix portals (menus, dialogs, ⌘K) inherit it. Ref-counted so overlapping mounts
 * during a route change never drop it early.
 */
export function useHudScope(): void {
  useEffect(() => {
    scopes += 1;
    document.documentElement.classList.add(HUD_CLASS);
    return () => {
      scopes -= 1;
      if (scopes <= 0) {
        scopes = 0;
        document.documentElement.classList.remove(HUD_CLASS);
      }
    };
  }, []);
}

/** For server layouts (admin): renders nothing, just holds the scope. */
export function HudScope(): null {
  useHudScope();
  return null;
}

/**
 * Turns the 90% zoom off while mounted. The live room's editors (Monaco, Excalidraw) map pointer
 * coordinates themselves and misplace clicks under CSS zoom.
 */
export function HudZoomOff(): null {
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-hud-zoom", "off");
    return () => el.removeAttribute("data-hud-zoom");
  }, []);
  return null;
}
```

- [ ] **Step 4: Run it.** Same command. Expected: PASS (3 tests).

- [ ] **Step 5: Tailwind.** In `tailwind.config.js`:
  - add `const plugin = require("tailwindcss/plugin");` at the top;
  - in `borderRadius` add `shell: 'var(--radius-shell)'`;
  - change `plugins` to `[require("tailwindcss-animate"), plugin(({ addVariant }) => addVariant("hud", ".iq-hud &"))]`.

- [ ] **Step 6: Tokens + decorations in `globals.css`.**
  - In `:root` add `--radius-shell: 18px;` (today's shell radius, so nothing moves out of scope).
  - Append this block after the `.dark { … }` block, inside the same first `@layer base`:

```css
  /* ---- HUD scope (signed-in app + admin; class set by useHudScope) ---- */
  html.iq-hud {
    --radius: 0.375rem; /* lg 6px cards · md 4px controls · sm 2px pills */
    --radius-shell: 8px;
    --hud-zoom: 0.9;
    --hud-tick: var(--line-4);
    --hud-grid: var(--line-2);
    --hud-glow: 0 0% 0% / 0.035;
    zoom: var(--hud-zoom);
  }
  html.iq-hud.dark {
    --hud-glow: 0 0% 100% / 0.05;
    --hud-grid: var(--line-2);
  }
  html.iq-hud[data-hud-zoom="off"] {
    --hud-zoom: 1;
  }
```

  - Add to `@layer components`:

```css
  /* In-scope pill radius (2px); out of scope .iq-pill keeps 4px. */
  .iq-hud .iq-pill {
    border-radius: 2px;
  }
  .iq-hud .iq-float {
    border-radius: var(--radius);
  }

  /* HUD decorations: inert outside .iq-hud. */
  .hud-ticks,
  .hud-spot,
  .hud-notch-line {
    display: none;
  }
  .iq-hud .hud-ticks {
    --t: hsl(var(--hud-tick));
    --l: 7px;
    position: absolute;
    inset: 5px;
    display: block;
    pointer-events: none;
    background:
      linear-gradient(var(--t), var(--t)) top left / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) top left / 1px var(--l) no-repeat,
      linear-gradient(var(--t), var(--t)) top right / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) top right / 1px var(--l) no-repeat,
      linear-gradient(var(--t), var(--t)) bottom left / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) bottom left / 1px var(--l) no-repeat,
      linear-gradient(var(--t), var(--t)) bottom right / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) bottom right / 1px var(--l) no-repeat;
  }
  /* A notched card's top-right corner is the notch itself: no tick there. */
  .iq-hud .hud-ticks[data-notch] {
    background:
      linear-gradient(var(--t), var(--t)) top left / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) top left / 1px var(--l) no-repeat,
      linear-gradient(var(--t), var(--t)) bottom left / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) bottom left / 1px var(--l) no-repeat,
      linear-gradient(var(--t), var(--t)) bottom right / var(--l) 1px no-repeat,
      linear-gradient(var(--t), var(--t)) bottom right / 1px var(--l) no-repeat;
  }
  .iq-hud .hud-card:hover > .hud-ticks,
  .iq-hud .hud-card:focus-within > .hud-ticks,
  .iq-hud .hud-card[data-active] > .hud-ticks {
    --t: hsl(var(--brand));
  }
  .iq-hud .hud-spot {
    position: absolute;
    inset: 0;
    z-index: -1;
    display: block;
    pointer-events: none;
    border-radius: inherit;
    opacity: 0;
    background: radial-gradient(280px circle at var(--mx, 50%) var(--my, 0%), hsl(var(--hud-glow)), transparent 70%);
    transition: opacity 150ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .iq-hud .hud-card:hover > .hud-spot {
    opacity: 1;
  }
  /* 45° notch, top-right. The clip removes the border there; .hud-notch-line redraws it. */
  .iq-hud .hud-notch {
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
  }
  .iq-hud .hud-notch-line {
    position: absolute;
    top: 5px;
    right: 5px;
    display: block;
    width: 14.142px;
    height: 2px;
    pointer-events: none;
    background: hsl(var(--line-2));
    transform: translate(50%, -50%) rotate(45deg);
  }
  /* Faint dot grid (panels, the page card, placeholders). */
  .iq-hud .hud-grid {
    background-image: radial-gradient(hsl(var(--hud-grid)) 1px, transparent 1.2px);
    background-size: 18px 18px;
    background-attachment: local;
  }
```

  - In the reduced-motion media block add `.hud-spot { display: none !important; }`. Also add `@media (pointer: coarse) { .hud-spot { display: none !important; } }`.

- [ ] **Step 7: Wire the scope.**
  - `AppShell.tsx`: `import { useHudScope } from "@/components/hud/scope";` and call `useHudScope();` first in the component body.
  - Change the root `h-dvh` → `h-[calc(100dvh/var(--hud-zoom,1))]`.
  - Change the page card's `rounded-[18px]` → `rounded-shell` (both the wrapper and the closed card). The open card `rounded-[30px]` → `rounded-[12px]`, the ghost `rounded-[26px]` → `rounded-[10px]`, the close-button `rounded-[30px]` → `rounded-[12px]`. These are menu-open morph states, kept as a proportional step up from the 8px shell.
  - `(admin)/layout.tsx`: render `<HudScope />` before `{children}` inside `RequireAuth`.
  - `LiveRoom.tsx`: render `<HudZoomOff />` as its first child.

- [ ] **Step 8: Verify.** `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web exec vitest run components/hud components/layout`. Expected: PASS. If an `AppShell.test.tsx` assertion on `h-dvh`/`rounded-[18px]` fails, update it to the new class.

### Task 2: HUD primitives

**Files:**
- Create in `apps/web/components/hud/`: `HudCard.tsx`, `HudEmpty.tsx`, `Readout.tsx`, `SegmentMeter.tsx`, `StatusDot.tsx`, `Kbd.tsx`, `index.ts`, `primitives.test.tsx`

**Interfaces:**
- Consumes: CSS classes from Task 1 (`hud-card`, `hud-ticks`, `hud-spot`, `hud-notch`, `hud-notch-line`).
- Produces:
  - `HudCard(props: HudCardProps)`
  - `HudEmpty({ title, hint?, tag?, children?, className? })`
  - `Readout({ label, value, unit?, note?, size?: "sm" | "lg", className? })`
  - `SegmentMeter({ segments, filled, tone?: "ink" | "brand", size?: "sm" | "md", label?, className? })`
  - `clampFilled(filled: number, segments: number): number`
  - `StatusDot({ state: DotState, label?, srLabel?, className? })`
  - `type DotState = "live" | "active" | "idle" | "warn" | "error"`
  - `dotClass(state: DotState): string`
  - `Kbd({ children, label?, size?: "sm" | "md" })`
  - `spotlightMove(e: React.PointerEvent<HTMLElement>): void`

- [ ] **Step 1: Write the failing tests** (`primitives.test.tsx`)

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HudCard, HudEmpty, Kbd, Readout, SegmentMeter, StatusDot, clampFilled, dotClass } from ".";

describe("clampFilled", () => {
  it.each([
    [2, 5, 2],
    [-1, 5, 0],
    [9, 5, 5],
    [2.6, 5, 3],
    [Number.NaN, 5, 0],
    [3, 0, 0],
  ])("clampFilled(%s, %s) = %s", (filled, segments, expected) => {
    expect(clampFilled(filled, segments)).toBe(expected);
  });
});

describe("SegmentMeter", () => {
  it("fills the clamped number of segments", () => {
    const { container } = render(<SegmentMeter segments={5} filled={2} />);
    const segs = container.querySelectorAll("[data-seg]");
    expect(segs).toHaveLength(5);
    expect(container.querySelectorAll("[data-seg='on']")).toHaveLength(2);
  });

  it("is an image with a label when labelled, hidden otherwise", () => {
    const { rerender } = render(<SegmentMeter segments={5} filled={2} label="Data depth 2 of 5" />);
    expect(screen.getByRole("img", { name: "Data depth 2 of 5" })).toBeInTheDocument();
    rerender(<SegmentMeter segments={5} filled={2} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("StatusDot", () => {
  it("pulses only when live", () => {
    expect(dotClass("live")).toContain("motion-safe:animate-");
    for (const s of ["active", "idle", "warn", "error"] as const) {
      expect(dotClass(s)).not.toContain("animate-");
    }
  });

  it("shows its label, or an sr-only one", () => {
    const { rerender } = render(<StatusDot state="active" label="Live" />);
    expect(screen.getByText("Live")).toBeVisible();
    rerender(<StatusDot state="idle" srLabel="Not connected" />);
    expect(screen.getByText("Not connected")).toHaveClass("sr-only");
  });
});

describe("HudCard", () => {
  it("renders title, meta, action, footer and names the region", () => {
    render(
      <HudCard title="Recent interviews" meta="03" action={<button type="button">All</button>} footer="SRC 02">
        body
      </HudCard>,
    );
    expect(screen.getByRole("region", { name: "Recent interviews" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent interviews" })).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByText("SRC 02")).toBeInTheDocument();
  });

  it("notches and wraps its header", () => {
    const { container } = render(<HudCard title="T" notch>x</HudCard>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("hud-notch");
    expect(container.querySelector(".hud-ticks")).toHaveAttribute("data-notch");
    expect(container.querySelector("[data-hud-header]")).toHaveClass("flex-wrap");
  });

  it("can render without a header", () => {
    const { container } = render(<HudCard aria-label="Plain">x</HudCard>);
    expect(container.querySelector("[data-hud-header]")).toBeNull();
    expect(screen.getByRole("region", { name: "Plain" })).toBeInTheDocument();
  });
});

describe("HudEmpty / Readout / Kbd", () => {
  it("HudEmpty shows the tag and copy", () => {
    render(<HudEmpty title="No interviews yet" hint="Book one." />);
    expect(screen.getByText("NO DATA")).toBeInTheDocument();
    expect(screen.getByText("No interviews yet")).toBeInTheDocument();
    expect(screen.getByText("Book one.")).toBeInTheDocument();
  });

  it("Readout shows label, value and note", () => {
    render(<Readout label="Profile score" value="—" note="coming soon" />);
    expect(screen.getByText("Profile score")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("coming soon")).toBeInTheDocument();
  });

  it("Kbd reads its label to screen readers", () => {
    render(<Kbd label="Command K">⌘K</Kbd>);
    expect(screen.getByText("Command K")).toHaveClass("sr-only");
  });
});
```

- [ ] **Step 2: Run it.** `pnpm --filter @interviewiq/web exec vitest run components/hud/primitives.test.tsx`. Expected: FAIL, modules missing.

- [ ] **Step 3: Implement.**

`SegmentMeter.tsx`:

```tsx
import { cn } from "@/lib/utils/cn";

/** Whole segments to fill: rounded, clamped to 0…segments; NaN and empty meters → 0. */
export function clampFilled(filled: number, segments: number): number {
  if (!Number.isFinite(filled) || segments <= 0) return 0;
  return Math.max(0, Math.min(segments, Math.round(filled)));
}

export interface SegmentMeterProps {
  segments: number;
  filled: number;
  /** Fill colour: ink (default, data) or brand (progress the user drives). */
  tone?: "ink" | "brand";
  size?: "sm" | "md";
  /** Accessible label. Without one the meter is decorative (a text label sits beside it). */
  label?: string;
  className?: string;
}

/** The HUD's segmented bar: data depth, readiness, sources linked. */
export function SegmentMeter({ segments, filled, tone = "ink", size = "sm", label, className }: SegmentMeterProps) {
  const on = clampFilled(filled, segments);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(segments, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          data-seg={i < on ? "on" : "off"}
          className={cn(
            "rounded-[1px]",
            size === "sm" ? "h-1" : "h-1.5",
            i < on ? (tone === "brand" ? "bg-brand" : "bg-foreground") : "bg-line-3",
          )}
        />
      ))}
    </span>
  );
}
```

`StatusDot.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type DotState = "live" | "active" | "idle" | "warn" | "error";

const DOT: Record<DotState, string> = {
  live: "bg-brand shadow-[0_0_0_3px_hsl(var(--brand)/0.18)] motion-safe:animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  active: "bg-brand",
  idle: "bg-faint-2",
  warn: "bg-[hsl(var(--color-lc-medium))]",
  error: "bg-destructive",
};

/** The dot's classes for a state. Only `live` pulses (and only when motion is allowed). */
export function dotClass(state: DotState): string {
  return DOT[state];
}

export interface StatusDotProps {
  state: DotState;
  /** Visible mono label ("LIVE", "OK"). */
  label?: React.ReactNode;
  /** Screen-reader text when there's no visible label. Colour is never the only signal. */
  srLabel?: string;
  className?: string;
}

/** Status dot + optional mono label. `live` = really running right now; never decorative. */
export function StatusDot({ state, label, srLabel, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[10.5px] uppercase leading-none tracking-[0.08em]",
        className,
      )}
    >
      <span aria-hidden data-motion={state === "live" ? "" : undefined} className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[state])} />
      {label ?? (srLabel ? <span className="sr-only">{srLabel}</span> : null)}
    </span>
  );
}
```

`Readout.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ReadoutProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  note?: React.ReactNode;
  size?: "sm" | "lg";
  className?: string;
}

/** Mono label over a tabular value (+ unit, + note): the HUD's KPI readout. */
export function Readout({ label, value, unit, note, size = "lg", className }: ReadoutProps) {
  return (
    <div className={cn("flex min-w-0 flex-col", size === "lg" ? "gap-2" : "gap-1", className)}>
      <span className="iq-eyebrow">{label}</span>
      <span
        className={cn(
          "flex items-baseline gap-1 font-mono tabular-nums leading-none",
          size === "lg" ? "text-[28px] tracking-[-0.04em] sm:text-[32px]" : "text-base tracking-[-0.02em]",
        )}
      >
        {value}
        {unit ? <span className="font-mono text-[11px] tracking-normal text-faint">{unit}</span> : null}
      </span>
      {note ? <span className="text-xs leading-[1.4] text-muted-foreground">{note}</span> : null}
    </div>
  );
}
```

`Kbd.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Keycap (2px, mono). `label` is what a screen reader hears instead of the glyphs. */
export function Kbd({
  children,
  label,
  size = "md",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-sm border border-line-3 bg-card font-mono text-foreground",
        size === "md" ? "h-6 min-w-6 px-1.5 text-[11px]" : "h-5 min-w-5 px-1 text-[10.5px]",
        className,
      )}
    >
      {label ? (
        <>
          <span aria-hidden>{children}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        children
      )}
    </kbd>
  );
}
```

`HudEmpty.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Empty card body: a dashed mono tag ("NO DATA") over the existing title + hint copy. */
export function HudEmpty({
  title,
  hint,
  tag = "No data",
  children,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  tag?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-1.5 px-4 py-7 sm:px-5", className)}>
      <span aria-hidden className="iq-pill mb-1 border border-dashed border-line-4 text-faint">
        {tag}
      </span>
      <p className="m-0 text-sm">{title}</p>
      {hint ? <p className="m-0 max-w-md text-[13px] leading-[1.5] text-muted-foreground">{hint}</p> : null}
      {children ? <div className="pt-2">{children}</div> : null}
    </div>
  );
}
```

`HudCard.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Moves the hover spotlight. Percentages, so it stays under the cursor at any zoom. */
export function spotlightMove(e: React.PointerEvent<HTMLElement>): void {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}

export interface HudCardProps {
  title?: React.ReactNode;
  /** Right of the leader line: a count, a status, a short readout. */
  meta?: React.ReactNode;
  /** Right-most control in the header (a "View all" link, an edit button). */
  action?: React.ReactNode;
  /** Mono readout strip under the body. */
  footer?: React.ReactNode;
  /** 45° top-right cut, the HUD signature. Hero/stat cards and ⌘K only. */
  notch?: boolean;
  /** `inverse` = the dark card in both themes (Up next). */
  tone?: "default" | "inverse";
  as?: "section" | "article" | "div" | "li";
  titleAs?: "h2" | "h3";
  /** Brightens the corner ticks (e.g. the selected item). */
  active?: boolean;
  spotlight?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  "aria-label"?: string;
  children?: React.ReactNode;
}

/**
 * The one bordered card of the signed-in app: hairline frame, a mono header readout
 * (TITLE ──── meta · action), optional footer strip, corner ticks and a cursor spotlight.
 * Decorations only draw inside `.iq-hud`.
 */
export function HudCard({
  title,
  meta,
  action,
  footer,
  notch = false,
  tone = "default",
  as: Tag = "section",
  titleAs: Title = "h2",
  active = false,
  spotlight = true,
  className,
  headerClassName,
  bodyClassName,
  "aria-label": ariaLabel,
  children,
}: HudCardProps) {
  const titleId = React.useId();
  const inverse = tone === "inverse";
  const hasHeader = title != null || meta != null || action != null;
  const named = Tag === "section" || Tag === "article";

  return (
    <Tag
      aria-labelledby={named && title != null && !ariaLabel ? titleId : undefined}
      aria-label={named ? ariaLabel : undefined}
      data-active={active ? "" : undefined}
      onPointerMove={spotlight ? spotlightMove : undefined}
      className={cn(
        "hud-card relative isolate flex min-w-0 flex-col overflow-hidden rounded-lg",
        inverse ? "bg-inv text-white" : "border border-line-2 bg-card",
        notch && "hud-notch",
        className,
      )}
    >
      {spotlight ? <span aria-hidden className="hud-spot" /> : null}
      <span aria-hidden className="hud-ticks" data-notch={notch ? "" : undefined} />
      {notch && !inverse ? <span aria-hidden className="hud-notch-line" /> : null}

      {hasHeader ? (
        <div
          data-hud-header
          className={cn(
            "flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 sm:px-5",
            inverse ? "border-white/10" : "border-line",
            headerClassName,
          )}
        >
          {title != null ? (
            <Title
              id={titleId}
              className={cn(
                "m-0 min-w-0 font-mono text-[11px] font-normal uppercase leading-normal tracking-[0.08em]",
                inverse ? "text-white/60" : "text-muted-foreground",
              )}
            >
              {title}
            </Title>
          ) : null}
          <span aria-hidden className={cn("h-px min-w-4 flex-1", inverse ? "bg-white/10" : "bg-line-2")} />
          {meta != null ? (
            <div className={cn("flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums", inverse ? "text-white/60" : "text-faint")}>
              {meta}
            </div>
          ) : null}
          {action != null ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}

      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>

      {footer != null ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] sm:px-5",
            inverse ? "border-white/10 text-white/50" : "border-line text-faint",
          )}
        >
          {footer}
        </div>
      ) : null}
    </Tag>
  );
}
```

`index.ts`:

```ts
export { HudCard, spotlightMove, type HudCardProps } from "./HudCard";
export { HudEmpty } from "./HudEmpty";
export { Readout, type ReadoutProps } from "./Readout";
export { SegmentMeter, clampFilled, type SegmentMeterProps } from "./SegmentMeter";
export { StatusDot, dotClass, type DotState, type StatusDotProps } from "./StatusDot";
export { Kbd } from "./Kbd";
export { HUD_CLASS, HudScope, HudZoomOff, useHudScope } from "./scope";
```

- [ ] **Step 4: Run it.** Same command. Expected: PASS. Then `pnpm --filter @interviewiq/web typecheck`: PASS.

### Task 3: Retrofit shared patterns

**Files:**
- Modify: `components/patterns/Panel.tsx`, `components/patterns/StatTile.tsx`, `components/patterns/EmptyState.tsx`, `components/ui/card.tsx`, `components/observability/ConsoleCard.tsx`
- Tests: update any failing `components/patterns/*.test.tsx`, `components/observability/*.test.ts`

**Interfaces:**
- Consumes: `HudCard`, `HudEmpty`, `Readout` (Task 2).
- Produces: the same public APIs as today (`Panel`, `StatTile`, `StatRow`, `EmptyState`, `Card*`, `ConsoleCard`, `HeaderCount`, `LookPill`, `CardEmpty`).

- [ ] **Step 1:** `Panel`: section class → `"hud-grid flex min-w-0 flex-col gap-4 rounded-lg bg-panel p-4 sm:p-5"`.
- [ ] **Step 2:** `StatTile` renders `<Readout label={label} value={value} className={cn("px-5 py-5", className)} />`. `StatRow` → `rounded-lg`.
- [ ] **Step 3:** `EmptyState` / `ui/card.tsx`: replace `rounded-[10px]`/`rounded-xl` → `rounded-lg`.
- [ ] **Step 4:** `ConsoleCard`: the body becomes:

```tsx
return (
  <HudCard title={title} meta={meta} aria-label={ariaLabel} className={className} bodyClassName={bodyClassName}>
    {children}
  </HudCard>
);
```

  `CardEmpty` returns `<HudEmpty title={title} hint={hint} />`.
- [ ] **Step 5: Run.** `pnpm --filter @interviewiq/web exec vitest run components`. Fix assertions that referenced removed classes; keep behaviour assertions. Expected: PASS.

### Task 4: Shell, top bar, search, palette

**Files:**
- Modify: `components/layout/app-shell/AppTopBar.tsx`, `CommandMenu.tsx`, `AppMenu.tsx`, `AccountMenu.tsx`, `components/layout/ThemeToggle.tsx`, `AppShell.tsx` (grid on `main`)
- Tests: `AppShell.test.tsx`, `AccountMenu.test.tsx`, plus a new `CommandMenu.test.tsx` case

**Interfaces:**
- Consumes: `Kbd`, `HUD` CSS classes.

- [ ] **Step 1: Failing test.** Add to a new `components/layout/app-shell/CommandMenu.test.tsx`: render `CommandMenu open items={[{ href: "/dashboard", label: "Dashboard", icon: Home }]}`, mocking `useJds` to return `{ data: [] }` and `useRouter` to return `{ push: vi.fn() }`, the same way `AppShell.test.tsx` mocks them. Assert:
  - `screen.getByText(/1 result/i)` (footer readout);
  - `screen.getByText("Screens")` (group header);
  - pressing `Enter` calls `push("/dashboard")`.

  Run it: FAIL (no footer/group yet).
- [ ] **Step 2: Top bar.**
  - Every `rounded-md` stays (it's now 4px). `iconButton` and the menu toggle are unchanged in shape.
  - Search button classes → `group hud-card relative isolate hidden h-[38px] min-w-0 flex-[0_1_440px] items-center gap-2.5 overflow-hidden rounded-md border border-line-4 bg-card pl-3 pr-1.5 text-left text-[13.5px] text-faint transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:flex`.
  - Children:
    - `<span aria-hidden className="absolute inset-y-1.5 left-0 w-[2px] scale-y-0 bg-brand transition-transform duration-150 ease-iq group-hover:scale-y-100 group-focus-visible:scale-y-100" />`
    - `<span aria-hidden className="hud-ticks" />`
    - `<span aria-hidden className="font-mono text-[13px] text-foreground">›</span>` (replaces `<Search>`)
    - the placeholder span unchanged
    - `<Kbd size="sm" label="Command K">⌘K</Kbd>`
- [ ] **Step 3: ThemeToggle** (shared with public layouts → `hud:` only):
  - track `rounded-full` → `rounded-full hud:rounded-md`;
  - thumb `rounded-full` → `rounded-full hud:rounded-[3px]`.
- [ ] **Step 4: Palette.**
  - Content: drop the `rounded-[12px] border … shadow-[…]` classes. Content becomes `fixed left-1/2 top-[12%] z-50 w-[calc(100%-2rem)] max-w-[580px] -translate-x-1/2 drop-shadow-[0_30px_40px_rgba(0,0,0,.35)] …(existing animate classes)`.
  - Inside it, wrap `Palette` in `<div className="hud-card hud-notch relative isolate overflow-hidden rounded-shell border border-line-2 bg-card"><span aria-hidden className="hud-ticks" data-notch="" /><span aria-hidden className="hud-notch-line" />…</div>`.
  - In `Palette`:
    - the input row gets a leading `<span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">Query ›</span>` and a trailing `<Kbd size="sm">Esc</Kbd>`;
    - entries render in two groups, `Screens` and `Roles`. Each group header is `<li role="presentation" className="flex items-center gap-2 px-3 pb-1 pt-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{name}<span className="tabular-nums">{String(count).padStart(2, "0")}</span></li>` and is omitted when the group is empty;
    - the active row adds `before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:bg-brand` (row `relative`);
    - the hint becomes `font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint`;
    - footer: `<div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint"><span>↑↓ Navigate · ↵ Open · Esc Close</span><span className="tabular-nums">{entries.length} {entries.length === 1 ? "result" : "results"}</span></div>`.
  - Keyboard indices still run over the flat `entries` array (headers are not options).
- [ ] **Step 5: AppMenu / AccountMenu:** every arbitrary radius → token per the scale (menu panels `rounded-lg`, items `rounded-md`, avatar `rounded-full`).
- [ ] **Step 6: Page grid:** `AppShell` `<main>` gets `hud-grid`.
- [ ] **Step 7: Run.** `pnpm --filter @interviewiq/web exec vitest run components/layout`. Update old class assertions. Expected: PASS incl. the new CommandMenu test.

### Task 5: Card consolidation

**Files:**
- Delete: `app/(app)/dashboard/_components/ListCard.tsx`, `app/(app)/help/_components/HelpCard.tsx`
- Modify: `app/(app)/profile/_components/ProfileCard.tsx`, `app/(app)/interviews/_components/SessionsList.tsx`, `app/(app)/interviews/[sessionId]/_components/SessionDetail.tsx`, every importer of the deleted files (`grep -rn "ListCard\|HelpCard" apps/web/app`)

**Interfaces:**
- Consumes: `HudCard`, `HudEmpty`, `Kbd`.
- Produces: `ProfileCard` (same props: `title`, `meta`, `action`, `children`, `className`) and `CardEmpty` (same props) as wrappers.

- [ ] **Step 1:** `ProfileCard` body:

```tsx
return (
  <HudCard title={title} meta={meta} action={action} className={className}>
    {children}
  </HudCard>
);
```

  and `CardEmpty` → `<HudEmpty title={title} hint={hint}>{children}</HudEmpty>`.
- [ ] **Step 2:** Callers of `ListCard`. The `action={{label, href}}` prop becomes `action={<Link href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">{label}<ArrowRight aria-hidden className="h-3.5 w-3.5" /></Link>}`. `ListEmpty` → `HudEmpty`.
- [ ] **Step 3:** `HelpCard` callers → `<HudCard title={title}>` (the section is named by `aria-labelledby` automatically; drop the explicit `id`, or keep it by passing `aria-label={title}`). `Kbd` imports → `@/components/hud`.
- [ ] **Step 4:** `SessionGroup` → `<HudCard title={title} meta={String(sessions.length).padStart(2, "0")}>`, empty → `HudEmpty`. `SessionDetail` details `section` → `HudCard`.
- [ ] **Step 5: Run.** `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web exec vitest run app`. Update tests asserting the old heading text styling only. Expected: PASS.

### Tasks 6–12: Section sweeps

Run after Tasks 1–5. Each sweep task touches only its own files; they can run in parallel.

**Shared sweep rules (every sweep task):**
- Radius map:
  - card/panel-sized `rounded-[10px]`, `[12px]`, `[14px]`, `rounded-xl` → `rounded-lg`;
  - control-sized `rounded-[5px]`, `[6px]`, `[7px]`, `[8px]`, `rounded-lg` on ≤48px tiles/buttons → `rounded-md`;
  - tag/chip-sized `rounded`, `rounded-[2px]`, `[3px]`, `rounded-sm` → `rounded-sm`;
  - meter segments → `rounded-[1px]` (inside `SegmentMeter` only).
- `rounded-full` only on avatars/dots; elsewhere → `rounded-md`.
- **Components rendered outside the scope** (only the connections tree in Task 9) keep the old class and add `hud:rounded-*`.
- Frames → `HudCard`, empty bodies → `HudEmpty`, meters → `SegmentMeter`, status pills with a real state → `StatusDot` (+ the same words as label), keycaps → `Kbd`.
- No copy changes beyond mono readout labels restating on-screen facts. No invented live states.
- After each task: `pnpm --filter @interviewiq/web typecheck`, `pnpm --filter @interviewiq/web lint`, `pnpm --filter @interviewiq/web exec vitest run <task paths>`. All PASS; tests updated only for changed markup/classes.

### Task 6: Dashboard (`app/(app)/dashboard/_components/`)
- `Greeting`:
  - eyebrow becomes `${weekday short} ${dd} ${MON} · ${HH:mm} ${tz}`, uppercase, via `toLocaleDateString`/`toLocaleTimeString` with `{ timeZoneName: "short" }` (e.g. `FRI 02 OCT · 12:30 GMT+5:30`);
  - keep the `now` prop for tests;
  - add a test: given `new Date("2026-10-02T12:30:00")`, the eyebrow matches `/^FRI 02 OCT · 12:30/`.
- `UpNextCard`:
  - becomes `HudCard tone="inverse" notch as="section" aria-label="Up next" className="min-h-[250px] flex-[2_1_420px]" bodyClassName="flex flex-col gap-[18px] p-5 sm:p-[26px]"`;
  - header `title` = the existing eyebrow text; `meta` = `<StatusDot state={joinable ? "live" : "idle"} label={statusLabel(session)} className="text-white" />`, shown only when a session exists;
  - chips → a readout strip: `<dl className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">`. Each item is `<div className="bg-inv px-3 py-2"><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/50">Slot</dt><dd className="m-0 mt-0.5 text-[13px] text-white/90">…</dd></div>` for Slot, Level and Track (Track only with a specialization);
  - CTA `rounded-[5px]` → `rounded-md`. All `#…` colours → `white/…` opacities.
- `ReadinessCard`: `HudCard notch aria-label="Readiness" title="Readiness" className="flex-[1_1_260px]" bodyClassName="flex flex-col gap-3.5 p-5 sm:p-6"`. Body: "Not started", `<SegmentMeter segments={4} filled={0} size="md" />`, the copy, the link.
- `ScoreTiles`: each tile = `<li><HudCard notch as="div" bodyClassName="p-4 sm:p-5"><Readout label={tile.label} value={<><span aria-hidden>—</span><span className="sr-only">Not available yet</span></>} note={tile.note} /><StatusDot state="idle" label="Pending" className="mt-3 text-faint" /></HudCard></li>`.
- `RecentInterviews`: row grid → `grid-cols-[28px_minmax(0,1fr)_auto_28px]`, with a leading `<span className="font-mono text-[11px] tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>`. The meta line becomes `font-mono text-[11.5px]`.
- `LeaderboardCard`: `HudCard title="Leaderboard"` + `HudEmpty` (same copy).

### Task 7: Jobs (`app/(app)/jobs/**`)
- `CompanyTile`: sizes `rounded-[7px]`/`rounded-lg`/`rounded-[10px]` → `rounded-md` for all sizes.
- `DepthMeter`: `Bars` → `<SegmentMeter segments={DEPTH_STEPS} filled={filled} />`. The non-compact label row becomes `<span className="iq-eyebrow">Data depth</span>` + `<span className="font-mono text-[11px] tabular-nums">{depth.bars}/{DEPTH_STEPS}</span>` + `{depth.label}`. Existing labels stay.
- `CompanyCard`:
  - `<HudCard as="article" aria-label={entry.name} active={entry.live} bodyClassName="flex min-h-[200px] flex-col gap-3.5 p-5">` replaces the `<article>`; keep `aria-labelledby={headingId}` semantics by passing no title and keeping the inner `h2 id`. To do that, `HudCard` takes an optional `aria-labelledby` (add the prop to `HudCard`: when provided it's used verbatim);
  - pill → `<StatusDot state={entry.live ? "active" : "idle"} label={entry.live ? "Live" : "Researching"} />`;
  - dashed "Nothing to open yet" `rounded-md` stays.
- `CompanyLibrary`: the search input and the segmented control → `rounded-md`; the active segment `rounded-[3px]`. Empty/dashed blocks → `rounded-lg`.
- `RoleList`: chips → `rounded-md`; the "No roles match" block → `rounded-lg`; `RoleRow` → `rounded-md` + hover `ArrowRight` slides `translate-x-0.5`.
- `[jobId]/Roadmap` + `RoundCard`:
  - the list becomes `relative` with a rail `<span aria-hidden className="absolute bottom-6 left-[calc(1rem+19px)] top-6 w-px bg-line-3 sm:left-[calc(1.25rem+23px)]" />`;
  - the number tile shows `R{nn}` mono, `rounded-md`, `bg-card` (sits on the rail);
  - the `li` → `rounded-lg`; topic chips → `rounded-sm font-mono text-[11px]`.
- `RoadmapHeader.ReadinessMeter` → `SegmentMeter segments={4} filled={0} size="md"`. `InsightsTab`/`ProcessTab` frames → `HudCard`/`Panel`; radius per map.

### Task 8: Profile (`app/(app)/profile/**`)
- `IdentityCard`: outer frame → `HudCard notch`. The two score slots → `Readout` with `—` (+ sr text "Not available yet") and the existing notes.
- `SummaryCard`: bullet dot → `<span aria-hidden className="mt-[3px] flex-none font-mono text-[12px] text-faint">›</span>`; the notable `MonoPill` stays (its radius is now scoped).
- `SourceActivity`, `ResumeFileRow`, `ProfileSkeleton`, `details/*`: radius map; frames via `ProfileCard`.

### Task 9: Connections (`app/(app)/connections/_components/**`). Rendered in onboarding too.
- Every radius change here is `old hud:new`, e.g.:
  - `SourceRow` stack `rounded-lg` → `rounded-lg` (token, unchanged outside: 7px today, so no `hud:` needed);
  - `SourceTile` `rounded-lg` → `rounded-lg hud:rounded-md`, `rounded-[7px]` → `rounded-[7px] hud:rounded-md`;
  - `ConnectionsGrid` skeleton `rounded-lg` → `rounded-lg`.
- `SourceRow`: new optional prop `state?: DotState`. When given, render `<StatusDot state={state} srLabel={…} className="hidden hud:inline-flex" />` before the name. `SourceList` passes:
  - `active` for connected;
  - `live` while syncing/importing (from the existing pill condition);
  - `error` when `errorSource === source` or on a sync error;
  - `idle` otherwise.

  Add a unit test for the mapping function `sourceDotState({ connected, syncing, error })` in `SourceList.test.ts` (export it from `SourceList.tsx`).
- `ConnectionsAside` (in scope only): the `iq-float` count block → `<Readout label="Sources linked" value={data ? `${String(connected).padStart(2, "0")}/${String(live.length).padStart(2, "0")}` : "—"} />` + `<SegmentMeter segments={live.length} filled={connected} tone="brand" size="md" className="mt-3" />`. Keep the "of N available sources connected" sentence as `sr-only` for screen readers.

### Task 10: Interviews (`app/(app)/interviews/**`)
- `StatusPill`: keep its export and the status → label map. Render `<StatusDot state={…} label={label} />` with:
  - `LIVE_IN_PROGRESS` → `live`;
  - `PREP_READY` → `active`;
  - `PREP_QUEUED` → `live` (preparing is really running);
  - `PREP_FAILED` → `error`;
  - `COMPLETED` → `idle`;
  - others → `idle`.

  Add `statusDotState(status)` + a table test in `StatusPill.test.ts`.
- `SessionsList` rows: meta already mono; radius map. `BookingForm`: radius map (choice tiles `rounded-md`, panels `rounded-lg`).
- `SessionDetail` progress panel → a step list with `relative` rail + dots (current = `StatusDot active`, done = `bg-foreground` dot, todo = `idle`). Radius map.
- `live/*`:
  - `ChecksView` rows → `flex items-center justify-between font-mono text-[12px] uppercase tracking-[0.06em]` with `StatusDot` from the existing check state (pass → `active` "OK", running → `live`, fail → `error`);
  - timer chip `rounded-[5px]` → `rounded-md`;
  - radius map in `PrejoinView`, `RoomFrame`, `LiveView`, `EndedView`, `LiveInterview`.
- `report/ReportPlaceholder`: radius map; empty block → `HudEmpty`-style dashed frame `rounded-lg`.

### Task 11: Intelligence + observability + visualizations
- `app/(app)/intelligence/**`, `components/observability/**`, `components/visualizations/**`: radius map.
- `STEP_DOT` in `status.ts` keeps its classes (already dot-shaped). Add `data-motion` where `running` is rendered if missing.
- `LogTerminal` / `LogStream` → `rounded-md`. `agent/PipelineNode` → `rounded-md`.
- Charts: internals untouched except radius.

### Task 12: Help, experiences, stubs, admin, components/ui
- `help/page.tsx` + `FaqList`: frames → `HudCard`. FAQ question gets a leading `<span className="font-mono text-[11px] tabular-nums text-faint">Q.{nn}</span>`.
- `experiences/*`: radius map; the guide frame → `HudCard`.
- Stub pages (loops, practice, leaderboard, settings/*, admin/*): wrap the existing text in `<div className={PAGE_SCAFFOLD}><HudCard title={<page title>} className="hud-grid"><HudEmpty tag="Not built yet" title={…existing title…} hint={…existing copy…} /></HudCard></div>`, reusing their current words. Pages without copy get title = the nav label and hint = "This screen is on the way."
- `components/ui/*`: radius map only where an arbitrary value is used (`rounded-[…]`, `rounded-xl`). shadcn `rounded-md/sm/lg` stay as-is.

### Task 13: Verification

- [ ] **Step 1:** `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web lint && pnpm --filter @interviewiq/web test`: all PASS.
- [ ] **Step 2: Radius audit.**

  ```bash
  grep -rnE "rounded-\[[0-9]+px\]|rounded-xl|rounded( |\")" 'apps/web/app/(app)' 'apps/web/app/(admin)' apps/web/components/layout/app-shell apps/web/components/observability apps/web/components/visualizations apps/web/components/hud --include='*.tsx' | grep -v "hud:rounded" | grep -v test
  ```

  Expected: only the documented morph states in `AppShell.tsx` and `SegmentMeter`'s `rounded-[1px]`.
- [ ] **Step 3: Visual check (Playwright, Chromium, running stack at :3000).** Signed in, light + dark, 1440px and 400px: dashboard, jobs, a roadmap, profile, connections, interviews + a session, intelligence, help, experiences, one stub. Read every screenshot.
- [ ] **Step 4: Zoom check.**
  - `getComputedStyle(document.documentElement).zoom === "0.9"` on `/dashboard`, `"1"` on `/login` and `/onboarding`, `"1"` on a live room.
  - Open the account menu, notifications popover and ⌘K; each popper's bounding box sits adjacent to its trigger.
- [ ] **Step 5: Out-of-scope check.** Screenshot `/`, `/login` and `/onboarding` before and after; they're visually identical.
