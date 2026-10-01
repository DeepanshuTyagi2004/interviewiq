import { RoundsPanel } from "./RoundsPanel";

/** Sign-in / sign-up layout: the form column beside the rotating rounds panel (stacks on phones). */
export function AuthSplit({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-wrap">
      <div className="flex min-w-0 flex-[1_1_460px] items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
        <div className="iq-rise flex w-full max-w-[400px] flex-col gap-[18px]">{children}</div>
      </div>
      <RoundsPanel />
    </div>
  );
}

/** Single centred column for the smaller flows (forgot / reset password, verify email). */
export function AuthColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-12 sm:py-16">
      <div className="iq-rise flex w-full max-w-[400px] flex-col gap-[18px]">{children}</div>
    </div>
  );
}
