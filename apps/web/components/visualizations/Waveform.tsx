import { cn } from "@/lib/utils/cn";

export interface WaveformProps {
  /** Number of bars. */
  bars?: number;
  /** Height of the tallest bar in px. */
  height?: number;
  /** Animate the bars (disabled automatically under prefers-reduced-motion). */
  animated?: boolean;
  className?: string;
}

/**
 * Decorative voice waveform: deterministic bar heights (identical on server and client) that
 * pulse with staggered durations. Colour comes from `currentColor`.
 */
export function Waveform({ bars = 34, height = 22, animated = true, className }: WaveformProps) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-[2px]", className)} style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          data-motion
          className="w-[2px] rounded-[1px] bg-current"
          style={{
            height: Math.round(height * (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))) * 100) / 100,
            animation: animated
              ? `iq-wave ${(0.7 + (i % 5) * 0.15).toFixed(2)}s ease-in-out ${(i * 0.05).toFixed(2)}s infinite`
              : undefined,
          }}
        />
      ))}
    </span>
  );
}
