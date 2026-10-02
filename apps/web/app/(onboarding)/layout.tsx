import type { Metadata } from "next";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { OnboardingGate } from "@/components/auth/OnboardingGate";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROUTES } from "@/lib/constants/shared";
import { SignOutButton } from "./_components/SignOutButton";

export const metadata: Metadata = {
  title: "Set up your profile · InterviewIQ",
};

/**
 * Focused onboarding shell — no app menu (the gate keeps new users here until they finish anyway).
 * Fits the viewport exactly: the top bar sits on the frame and the card fills the rest. The page
 * never scrolls; the wizard scrolls its own content inside the card.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex h-dvh flex-col overflow-hidden bg-frame">
        <header className="flex h-[68px] flex-none items-center gap-4 px-4 sm:px-8">
          <Logo href={ROUTES.home} />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>
        <main className="relative mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-line-3 bg-card sm:mx-3 sm:mb-3">
          {/* Sends users who have already finished onboarding to the dashboard. */}
          <OnboardingGate>{children}</OnboardingGate>
        </main>
      </div>
    </RequireAuth>
  );
}
