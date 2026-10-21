import * as React from "react";
import { Kbd as DsKbd } from "@/components/ds/Kbd";

/** Shim over `ds/Kbd`. `label` is what a screen reader hears instead of the glyphs. */
export function Kbd({
  children,
  label,
  size: _size,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  void _size;
  return (
    <DsKbd className={className}>
      {label ? (
        <>
          <span aria-hidden>{children}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        children
      )}
    </DsKbd>
  );
}
