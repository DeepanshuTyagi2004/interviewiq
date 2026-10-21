import { SegmentBar, clampFilled } from "@/components/ds/SegmentBar";

export { clampFilled };

export interface SegmentMeterProps {
  segments: number;
  filled: number;
  /** Ignored: the bar is ink on surface-2 everywhere now. */
  tone?: "ink" | "brand";
  size?: "sm" | "md";
  /** Accessible label. Without one the meter is decorative. */
  label?: string;
  className?: string;
}

/** Shim over `ds/SegmentBar`. */
export function SegmentMeter({ tone: _tone, ...rest }: SegmentMeterProps) {
  void _tone;
  return <SegmentBar {...rest} />;
}
