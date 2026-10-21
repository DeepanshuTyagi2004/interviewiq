import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ds";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";

/**
 * The interview room's chrome on a plain page-coloured ground (spec §5.5). Before and after the interview (`page`)
 * there's a slim top bar with the brand, the theme switch and a way back; during it (`live`) the room fills the
 * screen and carries its own header, with no navigation out of the proctored round.
 */
export function RoomFrame({
  variant = "page",
  leave = true,
  children,
}: {
  variant?: "page" | "live";
  /** Show "Back to interviews" in the top bar (page variant). */
  leave?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      {variant === "page" ? (
        <header className="flex h-14 flex-none items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-7">
          <Logo href={ROUTES.dashboard} />
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <span className="hidden text-[13.5px] text-ink-3 sm:block">Interview room</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            {leave ? (
              <Link
                href={ROUTES.interviews}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-background px-4 text-[13px] font-medium text-foreground shadow-ring transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Back to interviews</span>
                <span className="sm:hidden">Back</span>
              </Link>
            ) : null}
          </div>
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** A centred card inside a `page` frame (gate, checks, ended, error). Scrolls when tall. The card has no clipping, so
 * anything that animates past its box (the ended view's mascot) stays whole. */
export function RoomCentered({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="m-auto w-full max-w-[640px] px-4 py-8 sm:px-6 sm:py-12">
        <Card as="div" className={cn("gap-[18px] p-6 sm:p-9", className)}>
          {children}
        </Card>
      </div>
    </div>
  );
}
