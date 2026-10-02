import * as React from "react";

/** Zero-padded HUD count: 2 → "02", 12 → "12". Not a number → "—" (never a made-up zero). */
export function padCount(n: number, width = 2): string {
  if (!Number.isFinite(n)) return "—";
  return String(Math.max(0, Math.trunc(n))).padStart(width, "0");
}

/**
 * A count as the HUD shows it ("02") while screen readers hear plain words ("2 sessions"), not
 * "zero two". `label` defaults to the bare number.
 */
export function Count({ n, label, className }: { n: number; label?: string; className?: string }) {
  return (
    <>
      <span aria-hidden className={className}>
        {padCount(n)}
      </span>
      <span className="sr-only">{label ?? (Number.isFinite(n) ? String(n) : "unknown")}</span>
    </>
  );
}
