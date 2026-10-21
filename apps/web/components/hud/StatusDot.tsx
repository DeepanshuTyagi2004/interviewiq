import * as React from "react";
import { StatusDot as DsStatusDot, dotClass, type DotState } from "@/components/ds/StatusDot";

export { dotClass, type DotState };

export interface StatusDotProps {
  state: DotState;
  /** Visible label ("Live", "OK"). */
  label?: React.ReactNode;
  /** Screen-reader text when there is no visible label. */
  srLabel?: string;
  className?: string;
}

/** Shim over `ds/StatusDot`: maps the old `srLabel` onto `label` + `srOnly`. */
export function StatusDot({ state, label, srLabel, className }: StatusDotProps) {
  if (label != null) return <DsStatusDot state={state} label={label} className={className} />;
  return <DsStatusDot state={state} label={srLabel} srOnly className={className} />;
}
