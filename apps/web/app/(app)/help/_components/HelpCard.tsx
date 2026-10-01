import * as React from "react";

/** Bordered card with the design's title row, as used across the signed-in pages. */
export function HelpCard({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-[10px] border border-line-2 bg-card">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 id={id} className="m-0 text-sm font-normal">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** A keycap, styled like the shell's "Menu M" hint. `label` is what a screen reader hears. */
export function Kbd({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-line-3 bg-card px-1.5 font-mono text-[11px] text-foreground">
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
