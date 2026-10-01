"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import type { JdSummary } from "@/features/jobs";
import { ConnectionsGrid } from "@/app/(app)/connections/_components/ConnectionsGrid";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import type { CandidateProfileResponse } from "../types";
import { EducationExperienceFields } from "./EducationExperienceFields";
import { OnboardingSteps } from "./OnboardingSteps";
import { ParsedSummary } from "./ParsedSummary";
import { PersonalFields } from "./PersonalFields";
import { ProfilePreview } from "./ProfilePreview";
import { ResumeUpload } from "./ResumeUpload";
import { TargetPicker, targetLabel } from "./TargetPicker";

const STEPS = ["Résumé", "Profile", "Sources", "Target"] as const;
const LAST = STEPS.length - 1;

const COPY: { eyebrow: string; title: string; description: string }[] = [
  {
    eyebrow: "Step 1 of 4 · Résumé",
    title: "Start with your résumé",
    description: "We'll read it and fill in your profile. You can edit everything on the next step.",
  },
  {
    eyebrow: "Step 2 of 4 · Profile",
    title: "Check your profile",
    description: "This is what the interviewer will know about you. Fix anything we got wrong.",
  },
  {
    eyebrow: "Step 3 of 4 · Sources",
    title: "Connect your work",
    description: "Optional — but the more we see, the more personal your questions get.",
  },
  {
    eyebrow: "Step 4 of 4 · Target",
    title: "Where are you interviewing?",
    description: "Optional. Pick a company and role to get its real interview process, round by round.",
  },
];

/**
 * Four-step onboarding from the design — Résumé → Profile → Sources → Target — beside a live
 * profile preview. Only name + email are required; the Target step is optional and, when used,
 * finishing lands on that role's roadmap instead of the dashboard.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useCandidateForm(emptyCandidateForm);
  const save = useSaveCandidateProfile();
  const existing = useCandidateProfile();

  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState(false);
  const [target, setTarget] = useState<JdSummary | null>(null);
  // Whether the form has been seeded (saved profile, parsed résumé or manual edits). A ref, not
  // state: it only guards the prefill effect and never affects what renders.
  const seeded = useRef(false);

  // If the user already has a saved profile (e.g. returned mid-onboarding), prefill the form once.
  useEffect(() => {
    if (!seeded.current && existing.data) {
      form.reset(responseToForm(existing.data));
      seeded.current = true;
    }
  }, [existing.data, form]);

  function handleParsed(draft: CandidateProfileResponse) {
    form.reset(responseToForm(draft));
    // Parsed data wins — a slower initial GET /candidate-profile must not clobber it.
    seeded.current = true;
    setParsed(true);
  }

  async function next() {
    if (step === 0) seeded.current = true; // entering details manually from here on
    // Only the Profile step has required fields.
    if (step === 1 && !(await form.trigger(["fullName", "email"]))) return;
    setStep((s) => Math.min(s + 1, LAST));
  }

  const finish = (chosen: JdSummary | null) =>
    form.handleSubmit(
      (values) => {
        const payload = formToRequest(chosen ? { ...values, targetRole: targetLabel(chosen) } : values, true);
        save.mutate(payload, {
          onSuccess: () => {
            // Optimistically flip the cached /me so the OnboardingGate admits us to the app at once.
            queryClient.setQueryData<CurrentUser>(["auth", "me"], (old) =>
              old ? { ...old, onboardingComplete: true } : old,
            );
            toast.success("You're all set!");
            router.replace(chosen ? `${ROUTES.jobs}/${chosen.id}` : ROUTES.dashboard);
          },
          onError: () => toast.error("Couldn't save your details. Please try again."),
        });
      },
      () => {
        setStep(1);
        toast.error("Please complete the required fields.");
      },
    )();

  const copy = COPY[step];
  const nextLabel =
    step === LAST ? (target ? "Build my roadmap" : "Finish") : step === 0 && !parsed ? "Continue without résumé" : "Continue";

  return (
    <div className="flex flex-1 flex-col">
      <OnboardingSteps steps={[...STEPS]} current={step} />

      <FormProvider {...form}>
        <div className="flex flex-1 flex-wrap">
          <section aria-labelledby="onboarding-title" className="flex min-w-0 flex-[1.5_1_520px] flex-col px-5 pb-8 pt-8 sm:px-12 sm:pt-12">
            {/* Keyed by step so each screen gets the entrance animation. */}
            <div key={step} className="iq-rise flex w-full max-w-[640px] flex-1 flex-col gap-4">
              <p className="iq-eyebrow m-0">{copy.eyebrow}</p>
              <h1 id="onboarding-title" className="m-0 text-balance text-[30px] font-normal leading-[1.08] tracking-[-0.04em] sm:text-[36px]">
                {copy.title}
              </h1>
              <p className="m-0 mb-3 text-[15px] leading-[1.5] text-muted-foreground">{copy.description}</p>

              {/* Prevent implicit submit-on-Enter; navigation is driven by the buttons below. */}
              <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
                {step === 0 ? (
                  <>
                    <ResumeUpload onParsed={handleParsed} successMessage="Résumé parsed — check what we found below." />
                    {parsed ? <ParsedSummary control={form.control} /> : null}
                  </>
                ) : null}
                {step === 1 ? (
                  <div className="flex flex-col gap-8">
                    <PersonalFields showTargetRole={false} />
                    <EducationExperienceFields />
                  </div>
                ) : null}
                {step === 2 ? (
                  <div className="flex flex-col gap-3">
                    <ConnectionsGrid className="sm:grid-cols-1 lg:grid-cols-1" />
                    <p className="m-0 text-[12.5px] text-faint">We only read public activity. Disconnect any time from your profile.</p>
                  </div>
                ) : null}
                {step === 3 ? <TargetPicker value={target} onChange={setTarget} /> : null}
              </form>

              <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-8">
                {step > 0 ? (
                  <Button type="button" variant="outline" className="h-11 px-[18px]" onClick={() => setStep((s) => s - 1)}>
                    Back
                  </Button>
                ) : null}
                {step >= 2 ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-11 px-3.5 text-muted-foreground underline"
                    onClick={() => (step === LAST ? finish(null) : void next())}
                    disabled={save.isPending}
                  >
                    Skip for now
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="ml-auto h-11 gap-2.5 px-[22px]"
                  onClick={() => (step === LAST ? finish(target) : void next())}
                  disabled={save.isPending}
                >
                  {save.isPending ? "Saving…" : nextLabel}
                  <ArrowRight aria-hidden />
                </Button>
              </div>
            </div>
          </section>

          <ProfilePreview control={form.control} target={target ? targetLabel(target) : null} />
        </div>
      </FormProvider>
    </div>
  );
}
