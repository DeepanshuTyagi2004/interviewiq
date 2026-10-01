import type { DataAvailability } from "@/features/jobs";
import { cn } from "@/lib/utils/cn";
import { DEPTH_STEPS, depthOf } from "./library";

function Bars({ filled, className }: { filled: number; className?: string }) {
  return (
    <span aria-hidden className={cn("grid grid-cols-5 gap-[3px]", className)}>
      {Array.from({ length: DEPTH_STEPS }, (_, i) => (
        <span key={i} className={cn("h-1 rounded-sm", i < filled ? "bg-foreground" : "bg-line-2")} />
      ))}
    </span>
  );
}

export interface DepthMeterProps {
  availability: DataAvailability | undefined;
  /** Inline variant for role rows: bars + level, no caption. */
  compact?: boolean;
  className?: string;
}

/** "Data depth" label + the design's 5-bar meter, from the brief's real data confidence. */
export function DepthMeter({ availability, compact = false, className }: DepthMeterProps) {
  const depth = depthOf(availability);

  if (compact) {
    return (
      <span className={cn("flex flex-none items-center gap-2 text-xs text-muted-foreground", className)}>
        <span className="sr-only">Data depth:</span>
        <Bars filled={depth.bars} className="w-14" />
        <span className="w-[52px] whitespace-nowrap">{depth.label}</span>
      </span>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="m-0 flex justify-between gap-3 text-xs">
        <span className="text-faint">Data depth</span>
        <span>{depth.label}</span>
      </p>
      <Bars filled={depth.bars} />
    </div>
  );
}
