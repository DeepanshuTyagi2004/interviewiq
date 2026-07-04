"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/patterns";
import { ROUTES } from "@/lib/constants/shared";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import { ConnectionsGrid } from "@/app/(app)/connections/_components/ConnectionsGrid";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import type { CandidateProfileResponse } from "../types";
import { Stepper } from "./Stepper";
import { ResumeUpload } from "./ResumeUpload";
import { PersonalFields } from "./PersonalFields";
import { EducationExperienceFields } from "./EducationExperienceFields";

const STEPS = ["Personal details", "Education & experience", "Connectors"];

export function OnboardingWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useCandidateForm(emptyCandidateForm);
  const save = useSaveCandidateProfile();
  const existing = useCandidateProfile();

  const [phase, setPhase] = useState<"resume" | "steps">("resume");
  const [step, setStep] = useState(0);
  const [seeded, setSeeded] = useState(false);

  // If the user already has a saved profile (e.g. returned mid-onboarding), prefill the form once.
  useEffect(() => {
    if (!seeded && existing.data) {
      form.reset(responseToForm(existing.data));
      setSeeded(true);
    }
  }, [existing.data, seeded, form]);

  function handleParsed(draft: CandidateProfileResponse) {
    form.reset(responseToForm(draft));
    // Parsed data wins — mark seeded so a slower initial GET /candidate-profile can't clobber it.
    setSeeded(true);
    setPhase("steps");
    setStep(0);
  }

  function goToSteps() {
    // The user is entering details manually — don't let a late GET reset overwrite their edits.
    setSeeded(true);
    setPhase("steps");
    setStep(0);
  }

  async function next() {
    // Only step 1 (personal) has required validation before advancing.
    if (step === 0) {
      const ok = await form.trigger(["fullName", "email"]);
      if (!ok) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const finish = form.handleSubmit(
    (values) => {
      save.mutate(formToRequest(values, true), {
        onSuccess: () => {
          // Optimistically flip the cached /me so the OnboardingGate admits us to the app at once.
          queryClient.setQueryData<CurrentUser>(["auth", "me"], (old) =>
            old ? { ...old, onboardingComplete: true } : old,
          );
          toast.success("You're all set!");
          router.replace(ROUTES.dashboard);
        },
        onError: () => toast.error("Couldn't save your details. Please try again."),
      });
    },
    () => {
      setStep(0);
      toast.error("Please complete the required fields.");
    },
  );

  if (phase === "resume") {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-8 p-6">
        <PageHeader
          title="Let's build your profile"
          description="Upload your résumé and we'll prefill the details — or skip and enter them yourself."
        />
        <ResumeUpload onParsed={handleParsed} onSkip={goToSteps} />
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 p-6">
        <PageHeader
          title="Complete your profile"
          description="Review and edit the details below. You can change anything later."
        />
        <Stepper steps={STEPS} current={step} />

        {/* Prevent implicit submit-on-Enter; navigation is driven by the buttons below. */}
        <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
          {step === 0 ? <PersonalFields /> : null}
          {step === 1 ? <EducationExperienceFields /> : null}
          {step === 2 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your coding profiles to enrich your profile. This is optional — you can do
                it anytime from Connections.
              </p>
              <ConnectionsGrid />
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-6">
            <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={finish} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Finish"}
              </Button>
            )}
          </div>
        </form>
      </div>
    </FormProvider>
  );
}
