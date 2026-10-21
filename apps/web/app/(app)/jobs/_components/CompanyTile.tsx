import { cn } from "@/lib/utils/cn";

const SIZES = {
  sm: "h-[34px] w-[34px] rounded-[10px] text-sm",
  md: "h-10 w-10 rounded-lg text-base",
  lg: "h-12 w-12 rounded-[14px] text-lg sm:h-14 sm:w-14 sm:text-[22px]",
} as const;

export interface CompanyTileProps {
  name: string;
  /** Live companies get the solid ink tile, the rest the soft surface one (as in the design). */
  live: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}

/** The design's mono initial tile. Decorative: the company name is always shown next to it. */
export function CompanyTile({ name, live, size = "md", className }: CompanyTileProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex flex-none items-center justify-center font-display font-medium",
        SIZES[size],
        live ? "bg-ink text-background" : "bg-surface-2 text-ink-2",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
