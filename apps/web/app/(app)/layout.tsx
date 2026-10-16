import { RequireAuth } from "@/components/auth/RequireAuth";
import { OnboardingGate } from "@/components/auth/OnboardingGate";
import { AppShell } from "@/components/layout/app-shell/AppShell";
import { VisionPrefetch } from "@/features/interview-live/proctor/camera/VisionPrefetch";

/**
 * Signed-in shell: top bar on the grey frame, each page in a rounded card, and the menu revealed
 * behind the card. Onboarding lives in its own route group.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      {/* The live room's camera check files, downloaded once per device in the background. */}
      <VisionPrefetch />
      <AppShell>
        {/* Redirects users who haven't finished onboarding to /onboarding. */}
        <OnboardingGate>{children}</OnboardingGate>
      </AppShell>
    </RequireAuth>
  );
}
