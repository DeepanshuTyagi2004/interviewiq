import * as React from "react";
import { StatusDot } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { SOURCE_DOT_LABEL, type SourceDotState } from "./sourceDotState";

/**
 * `stack` — each source is its own bordered row (onboarding's Sources step, the Connections page).
 * `divided` — rows share one card, split by hairlines (the profile's "Connected sources" card).
 */
export type SourceRowVariant = "stack" | "divided";

export interface SourceRowProps {
  /** Two-letter mono mark shown on the ink tile ("GH"). */
  code: string;
  name: string;
  /** One faint line under the name: handle, counts, last sync — or what the source adds. */
  detail?: React.ReactNode;
  /** Optional mono status pill beside the name ("SYNCING", "SOON"). */
  pill?: React.ReactNode;
  /** Right-hand controls (Connect / Disconnect / Replace). They wrap under the text on narrow rows. */
  actions?: React.ReactNode;
  /** Expanded area under the row: a form, an upload zone, a status note. */
  children?: React.ReactNode;
  /** id for the expanded area, so a toggle can point `aria-controls` at it. */
  bodyId?: string;
  /** Hide the expanded area without unmounting it (keeps e.g. a running upload alive). */
  bodyHidden?: boolean;
  connected?: boolean;
  /**
   * The source's status dot (see `sourceDotState`), shown before the name on the Connections page,
   * the profile's sources card and onboarding alike.
   */
  state?: SourceDotState;
  /**
   * Screen-reader text for the dot. Omitted → the state's default (`SOURCE_DOT_LABEL`); a string
   * overrides it when the row means something more specific (an OAuth connect that failed is
   * "Connection failed", not "Sync error"); `null` → no sr text, for rows whose visible status pill
   * already says the same thing, so it isn't announced twice.
   */
  stateLabel?: string | null;
  /** Dims the tile for sources that aren't available yet. */
  unavailable?: boolean;
  variant?: SourceRowVariant;
  className?: string;
}

/** Logo square with the source's mono mark, as in the integration lists. */
export function SourceTile({
  code,
  unavailable,
  size = "md",
}: {
  code: string;
  unavailable?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex flex-none items-center justify-center font-mono",
        size === "md" ? "h-11 w-11 rounded-[12px] text-xs" : "h-[34px] w-[34px] rounded-[10px] text-xs",
        unavailable ? "text-ink-3 shadow-[inset_0_0_0_1px_hsl(var(--line))]" : "bg-surface-2 text-ink",
      )}
    >
      {code}
    </span>
  );
}

/** One source in a list: tile, name + detail, actions, and an optional expanded body. */
export function SourceRow({
  code,
  name,
  detail,
  pill,
  actions,
  children,
  bodyId,
  bodyHidden = false,
  connected = false,
  state,
  stateLabel,
  unavailable = false,
  variant = "stack",
  className,
}: SourceRowProps) {
  const stack = variant === "stack";
  // Conditional children like `{a ? <x/> : null}{b ? <y/> : null}` arrive as an array of nulls, which is truthy:
  // count only what renders, so a row with nothing to show gets no empty body (and no extra height).
  const hasBody = React.Children.toArray(children).length > 0;
  return (
    <li
      className={cn(
        "min-w-0 list-none transition-colors duration-200",
        stack
          ? cn(
              "rounded-[16px] border border-line px-4 py-3 shadow-ring",
              connected ? "bg-surface" : "bg-background",
            )
          : "border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <SourceTile code={code} unavailable={unavailable} size={stack ? "md" : "sm"} />
        <div className="min-w-[7rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {state ? (
              <StatusDot
                state={state}
                label={stateLabel === undefined ? SOURCE_DOT_LABEL[state] : (stateLabel ?? undefined)}
                srOnly
              />
            ) : null}
            <p className={cn("m-0 tracking-[-0.01em]", stack ? "text-[15px]" : "text-sm")}>{name}</p>
            {pill}
          </div>
          {detail ? <p className="m-0 mt-0.5 truncate text-[12.5px] text-ink-3">{detail}</p> : null}
        </div>
        {actions ? <div className="ml-auto flex flex-none flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {hasBody ? (
        <div id={bodyId} hidden={bodyHidden} className={cn("mt-3.5", stack ? "sm:pl-[54px]" : "sm:pl-12")}>
          {children}
        </div>
      ) : null}
    </li>
  );
}
