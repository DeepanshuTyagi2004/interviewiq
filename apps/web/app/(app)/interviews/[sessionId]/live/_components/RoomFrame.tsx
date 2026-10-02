import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";

/**
 * The interview room's chrome, echoing the app shell: the grey frame with the page on a rounded
 * card. Before and after the interview (`page`) there's a slim top bar with the brand, the theme
 * switch and a way back; during it (`live`) the card fills the screen and carries its own header,
 * with no navigation out of the proctored round.
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
    <div className={cn("flex h-full w-full flex-col bg-frame text-foreground", variant === "live" && "p-1.5 sm:p-2")}>
      {variant === "page" ? (
        <header className="flex h-14 flex-none items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-7">
          <Logo href={ROUTES.dashboard} />
          <span aria-hidden className="hidden h-4 w-px bg-line-4 sm:block" />
          <span className="hidden text-[13.5px] text-muted-foreground sm:block">Interview room</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            {leave ? (
              <Link
                href={ROUTES.interviews}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-md border border-line-4 bg-card px-3 text-[13px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Back to interviews</span>
                <span className="sm:hidden">Back</span>
              </Link>
            ) : null}
          </div>
        </header>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line-3 bg-card",
          variant === "page" && "mx-2 mb-2 sm:mx-3 sm:mb-3",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Centred content inside a `page` frame (gate, checks, ended, error). Scrolls when tall. */
export function RoomCentered({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className={cn("m-auto flex w-full max-w-[620px] flex-col gap-[18px] px-5 py-10 sm:px-8 sm:py-14", className)}>
        {children}
      </div>
    </div>
  );
}
