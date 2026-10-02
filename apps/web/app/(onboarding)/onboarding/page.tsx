import { Suspense } from "react";
import { OnboardingWizard } from "@/features/onboarding/components/OnboardingWizard";

export default function OnboardingPage() {
  return (
    // The wizard reads `?error=` (a failed GitHub connect) via useSearchParams.
    <Suspense fallback={null}>
      <OnboardingWizard />
    </Suspense>
  );
}
