import { SegmentMeter } from "@/components/hud";
import type { DataAvailability } from "@/features/jobs";
import { cn } from "@/lib/utils/cn";
import { DEPTH_STEPS, depthOf } from "./library";

export interface DepthMeterProps {
  availability: DataAvailability | undefined;
  /** Inline variant for role rows: bars + level, no caption. */
  compact?: boolean;
  className?: string;
}

/** "Data depth" label + the design's 5-segment meter, from the brief's real data confidence. */
export function DepthMeter({ availability, compact = false, className }: DepthMeterProps) {
  const depth = depthOf(availability);

  if (compact) {
    return (
      <span className={cn("flex flex-none items-center gap-2 text-xs text-muted-foreground", className)}>
        <span className="sr-only">Data depth:</span>
        <SegmentMeter segments={DEPTH_STEPS} filled={depth.bars} className="w-14" />
        <span className="w-[52px] whitespace-nowrap">{depth.label}</span>
      </span>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="m-0 flex items-baseline justify-between gap-3 text-xs">
        <span className="iq-eyebrow">Data depth</span>
        <span className="flex items-baseline gap-2">
          {/* Readout restating the meter; screen readers get it as words instead. */}
          <span aria-hidden className="font-mono text-[11px] tabular-nums text-faint">
            {depth.bars}/{DEPTH_STEPS}
          </span>
          <span className="sr-only">
            {depth.bars} of {DEPTH_STEPS},{" "}
          </span>
          <span>{depth.label}</span>
        </span>
      </p>
      <SegmentMeter segments={DEPTH_STEPS} filled={depth.bars} />
    </div>
  );
}
