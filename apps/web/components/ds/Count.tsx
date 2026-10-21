import * as React from "react";

/** A plain, unpadded count; "—" when it is not a finite number. Screen readers get `label` or the number. */
export function Count({ n, label }: { n: number; label?: string }) {
  const ok = Number.isFinite(n);
  return (
    <>
      <span aria-hidden>{ok ? String(Math.max(0, Math.trunc(n))) : "—"}</span>
      <span className="sr-only">{label ?? (ok ? String(n) : "unknown")}</span>
    </>
  );
}
