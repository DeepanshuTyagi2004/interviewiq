import * as React from "react";

/** Zero-padded count: 2 → "02", 12 → "12". Not a number → "—" (never a made-up zero). */
export function padCount(n: number, width = 2): string {
  if (!Number.isFinite(n)) return "—";
  return String(Math.max(0, Math.trunc(n))).padStart(width, "0");
}

/**
 * Shim: a plain number (the padding is gone) while screen readers hear `label`, or the bare
 * number. Accepts the old `className`.
 */
export function Count({ n, label, className }: { n: number; label?: string; className?: string }) {
  const ok = Number.isFinite(n);
  return (
    <>
      <span aria-hidden className={className}>
        {ok ? String(Math.max(0, Math.trunc(n))) : "—"}
      </span>
      <span className="sr-only">{label ?? (ok ? String(n) : "unknown")}</span>
    </>
  );
}
