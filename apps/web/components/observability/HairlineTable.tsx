import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The design's hairline table (as on the leaderboard): mono uppercase 10px column heads, `line`
 * row rules, no outer chrome (put it inside a ConsoleCard). Wide tables scroll inside their own
 * focusable, labelled container so the page itself never scrolls sideways.
 */
export function HairlineTable({
  label,
  className,
  children,
}: {
  /** Accessible name for the scroll region. */
  label: string;
  /** Classes for the <table>, e.g. a `min-w-[720px]` that triggers the inner scroll on phones. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function HairlineHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line-2">{children}</tr>
    </thead>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-3 text-left align-middle font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-faint first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line last:border-b-0", className)} {...props} />;
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-3 py-3 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", className)}
      {...props}
    />
  );
}
