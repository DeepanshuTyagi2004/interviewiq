import { RoundsPanel } from "./RoundsPanel";

/**
 * Sign-in / sign-up layout. Desktop: the form column beside the rotating rounds panel, both
 * filling the card's height (the form scrolls on its own only if it must). Phones and tablets:
 * form then panel, scrolling together inside the card.
 */
export function AuthSplit({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:flex-row lg:overflow-hidden">
      {/* A block (not flex) scroller, so the centred child grows past it instead of overflowing
          upward — vertically centred when it fits, scrollable from the top when it doesn't. */}
      <div className="min-w-0 flex-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className="flex min-h-full w-full items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
          <div className="iq-rise flex w-full max-w-[400px] flex-col gap-[18px]">{children}</div>
        </div>
      </div>
      <RoundsPanel />
    </div>
  );
}

/** Single centred column for the smaller flows (forgot / reset password, verify email). */
export function AuthColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="flex min-h-full w-full items-center justify-center px-5 py-12 sm:py-16">
        <div className="iq-rise flex w-full max-w-[400px] flex-col gap-[18px]">{children}</div>
      </div>
    </div>
  );
}
