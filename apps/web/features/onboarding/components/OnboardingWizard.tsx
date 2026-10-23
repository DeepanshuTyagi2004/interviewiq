"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormProvider, useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import type { JdSummary } from "@/features/jobs";
import { ConnectionsGrid } from "@/app/(app)/connections/_components/ConnectionsGrid";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import { clearStep, readStep, writeStep } from "../step-memory";
import type { CandidateProfileResponse } from "../types";
import { EducationExperienceFields } from "./EducationExperienceFields";
import { OnboardingSteps } from "./OnboardingSteps";
import { ParsedSummary } from "./ParsedSummary";
import { PersonalFields } from "./PersonalFields";
import { ProfilePreview } from "./ProfilePreview";
import { ResumeUpload } from "./ResumeUpload";
import { TargetPicker, targetLabel } from "./TargetPicker";

const STEPS = ["Resume", "Profile", "Sources", "Target"] as const;
const PROFILE = 1;
const SOURCES = 2;
const LAST = STEPS.length - 1;
/** The step column's width — wide enough that form rows go 3–4 fields across beside the preview. */
const STEP_WIDTH = "max-w-[960px] 2xl:max-w-[1040px]";

const COPY: { eyebrow: string; title: string; description: string }[] = [
  {
    eyebrow: "Step 1 of 4 · Resume",
    title: "Start with your resume",
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

type DraftState = "idle" | "saving" | "saved" | "error";

/**
 * Four-step onboarding — Resume → Profile → Sources → Target — beside a live profile preview.
 *
 * Progress survives a refresh and the GitHub OAuth round trip: the profile is saved as a draft
 * (`complete: false`) once the resume is parsed and whenever the Profile step is left, and the
 * current step is remembered per tab. Name and current engineering level are required; Target is optional and,
 * when used, finishing lands on that role's roadmap.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const form = useCandidateForm(emptyCandidateForm);
  const draft = useSaveCandidateProfile();
  const finishSave = useSaveCandidateProfile();
  const existing = useCandidateProfile();

  // The step the candidate chose (or was on before a reload / OAuth redirect). Until they move,
  // a saved draft starts them on Profile, a fresh account on Resume.
  const [chosenStep, setChosenStep] = useState<number | null>(() => readStep(STEPS.length));
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the form has been seeded (saved draft, parsed resume or manual entry). A ref, not
  // state: it only guards the prefill effect and never affects what renders.
  const seeded = useRef(false);

  // Prefill from a saved draft (e.g. returning mid-onboarding), once.
  useEffect(() => {
    if (!seeded.current && existing.data) {
      form.reset(responseToForm(existing.data));
      seeded.current = true;
    }
  }, [existing.data, form]);

  const [resumeFilename, targetJdId, targetRole, resumeLinkedInUrl] = useWatch({
    control: form.control,
    name: ["resumeFilename", "targetJdId", "targetRole", "detectedLinks.linkedin"],
  });
  const hasResume = Boolean(resumeFilename);
  const step = chosenStep ?? (existing.data ? PROFILE : 0);
  // Back from GitHub's OAuth flow with a failure (carried here by the onboarding gate).
  const githubError = params.get("error") ? ("GITHUB" as const) : undefined;

  function goTo(next: number) {
    setChosenStep(next);
    writeStep(next);
    if (scrollRef.current) scrollRef.current.scrollTop = 0; // each step starts at its top
  }

  /** Save the form as an unfinished draft. Resolves either way — the wizard keeps its state. */
  async function saveDraft(): Promise<void> {
    setDraftState("saving");
    try {
      await draft.mutateAsync(formToRequest(form.getValues(), false));
      form.reset(form.getValues()); // the saved values are the new clean baseline
      setDraftState("saved");
    } catch {
      setDraftState("error");
      toast.error("Couldn't save your progress. You can keep going — we'll retry on the next step.");
    }
  }

  function handleParsed(parsed: CandidateProfileResponse) {
    form.reset({ ...responseToForm(parsed), level: form.getValues("level") });
    // Parsed data wins — a slower initial GET /candidate-profile must not clobber it.
    seeded.current = true;
    void saveDraft();
  }

  async function next() {
    if (step === 0) seeded.current = true; // entering details manually from here on
    if (step === PROFILE) {
      // Only the Profile step has required fields. Save before moving on, so a GitHub redirect
      // from the next step can't lose anything.
      if (!(await form.trigger(["fullName", "email", "level"]))) return;
      await saveDraft();
    }
    goTo(Math.min(step + 1, LAST));
  }

  async function back() {
    if (step === PROFILE && form.formState.isDirty) await saveDraft();
    goTo(Math.max(step - 1, 0));
  }

  function chooseTarget(jd: JdSummary | null) {
    form.setValue("targetJdId", jd?.id ?? "", { shouldDirty: true });
    form.setValue("targetRole", jd ? targetLabel(jd) : "", { shouldDirty: true });
  }

  const finish = (withTarget: boolean) => {
    if (!withTarget) chooseTarget(null);
    return form.handleSubmit(
      (values) => {
        finishSave.mutate(formToRequest(values, true), {
          onSuccess: () => {
            clearStep();
            // Optimistically flip the cached /me so the OnboardingGate admits us to the app at once.
            queryClient.setQueryData<CurrentUser>(["auth", "me"], (old) =>
              old ? { ...old, onboardingComplete: true } : old,
            );
            toast.success("You're all set!");
            router.replace(values.targetJdId ? `${ROUTES.jobs}/${values.targetJdId}` : ROUTES.dashboard);
          },
          onError: () => toast.error("Couldn't save your details. Please try again."),
        });
      },
      () => {
        goTo(PROFILE);
        toast.error("Please complete the required fields.");
      },
    )();
  };

  if (existing.isLoading) return <WizardSkeleton />;

  const copy = COPY[step];
  const busy = draft.isPending || finishSave.isPending;
  const preview = { control: form.control, target: targetJdId ? targetRole || null : null };
  const nextLabel =
    step === LAST ? (targetJdId ? "Build my roadmap" : "Finish") : step === 0 && !hasResume ? "Continue without resume" : "Continue";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OnboardingSteps steps={[...STEPS]} current={step} />

      <FormProvider {...form}>
        <div className="flex min-h-0 flex-1">
          <section aria-labelledby="onboarding-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The only scroll area: the page itself never scrolls, the step content does. */}
            <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div key={step} className={cn("iq-rise flex w-full flex-col gap-3 px-4 pb-6 pt-5 sm:px-8 sm:pt-7 xl:px-10", STEP_WIDTH)}>
                <p className="iq-eyebrow m-0">{copy.eyebrow}</p>
                <h1
                  id="onboarding-title"
                  className="m-0 text-balance text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]"
                >
                  {copy.title}
                </h1>
                <p className="m-0 mb-2 text-[14px] leading-[1.5] text-muted-foreground">{copy.description}</p>

                {/* Prevent implicit submit-on-Enter; navigation is driven by the footer buttons. */}
                <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
                  {step === 0 ? (
                    <>
                      <ResumeUpload
                        onParsed={handleParsed}
                        currentFilename={resumeFilename}
                        successMessage="Resume parsed — check what we found below."
                      />
                      {hasResume ? <ParsedSummary control={form.control} /> : null}
                    </>
                  ) : null}
                  {step === PROFILE ? (
                    <div className="flex flex-col gap-8">
                      <PersonalFields showTargetRole={false} />
                      <EducationExperienceFields />
                    </div>
                  ) : null}
                  {step === SOURCES ? (
                    <div className="flex flex-col gap-3">
                      {/* The resume has its own step — don't offer a second, competing upload here. */}
                      <ConnectionsGrid exclude={["RESUME"]} errorSource={githubError} className="sm:grid-cols-1 lg:grid-cols-1" resumeLinkedInUrl={resumeLinkedInUrl} />
                      <p className="m-0 text-[12.5px] text-faint">
                        We only read public activity. Disconnect any time from your profile.
                      </p>
                    </div>
                  ) : null}
                  {step === LAST ? <TargetPicker valueId={targetJdId || null} onChange={chooseTarget} /> : null}
                </form>

                {/* On phones the preview sits under the step instead of beside it. */}
                <ProfilePreview {...preview} className="mt-6 flex lg:hidden" />
              </div>
            </div>

            <footer className="flex-none border-t border-line px-4 py-3 sm:px-8 xl:px-10">
              <div className={cn("flex w-full flex-wrap items-center gap-2.5", STEP_WIDTH)}>
                {step > 0 ? (
                  <Button type="button" variant="outline" className="h-11 px-[18px]" onClick={() => void back()} disabled={busy}>
                    <ArrowLeft aria-hidden />
                    Back
                  </Button>
                ) : null}
                {step >= SOURCES ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-11 px-3.5 text-muted-foreground underline"
                    onClick={() => (step === LAST ? finish(false) : void next())}
                    disabled={busy}
                  >
                    Skip for now
                  </Button>
                ) : null}
                <DraftStatus state={draftState} />
                <Button
                  type="button"
                  className="ml-auto h-11 gap-2.5 px-[22px]"
                  onClick={() => (step === LAST ? finish(true) : void next())}
                  disabled={busy}
                >
                  {finishSave.isPending ? "Saving…" : draft.isPending && step === PROFILE ? "Saving draft…" : nextLabel}
                  <ArrowRight aria-hidden />
                </Button>
              </div>
            </footer>
          </section>

          <ProfilePreview {...preview} className="m-3 ml-0 hidden w-[380px] flex-none overflow-y-auto lg:flex xl:w-[440px]" />
        </div>
      </FormProvider>
    </div>
  );
}

/** Quiet mono note beside the footer buttons: is the draft on the server yet? */
function DraftStatus({ state }: { state: DraftState }) {
  if (state === "idle") return null;
  return (
    <span
      role={state === "error" ? "alert" : "status"}
      className={cn(
        "hidden font-mono text-xs uppercase tracking-[0.08em] sm:inline",
        state === "error" ? "text-destructive" : "text-faint",
      )}
    >
      {state === "saving" ? "Saving draft…" : state === "saved" ? "Draft saved" : "Draft not saved"}
    </span>
  );
}

function WizardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading onboarding">
      <div className="border-b border-line px-5 py-5 sm:px-8">
        <Skeleton className="h-6 w-full max-w-[720px]" />
      </div>
      <div className="flex flex-col gap-4 px-5 pt-8 sm:px-12 sm:pt-12">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className={cn("mt-4 h-[220px] w-full rounded-[14px]", STEP_WIDTH)} />
      </div>
    </div>
  );
}
