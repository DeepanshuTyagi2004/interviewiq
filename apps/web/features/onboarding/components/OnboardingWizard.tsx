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
import { useCurrentUser, type CurrentUser } from "@/lib/hooks/useCurrentUser";
import { ConnectionsGrid } from "@/app/(app)/connections/_components/ConnectionsGrid";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { guessLevelFromResume } from "../level-guess";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import { clearStep, readStep, writeStep } from "../step-memory";
import type { CandidateProfileResponse } from "../types";
import type { EngineeringLevel } from "@/lib/constants/engineering-levels";
import { EducationExperienceFields } from "./EducationExperienceFields";
import { OnboardingSteps } from "./OnboardingSteps";
import { ParsedSummary } from "./ParsedSummary";
import { PersonalFields } from "./PersonalFields";
import { ProfilePreview } from "./ProfilePreview";
import { ResumeUpload } from "./ResumeUpload";

const STEPS = ["Resume", "Profile", "Sources"] as const;
const PROFILE = 1;
const SOURCES = 2;
const LAST = SOURCES;
/** The step column's width — wide enough that form rows go 3–4 fields across beside the preview. */
const STEP_WIDTH = "max-w-[960px] 2xl:max-w-[1040px]";

const COPY: { eyebrow: string; title: string; description: string }[] = [
  {
    eyebrow: "Step 1 of 3 · Resume",
    title: "Start with your resume",
    description: "We'll read it and fill in your profile. You can edit everything on the next step.",
  },
  {
    eyebrow: "Step 2 of 3 · Profile",
    title: "Check your profile",
    description: "This is what the interviewer will know about you. Fix anything we got wrong.",
  },
  {
    eyebrow: "Step 3 of 3 · Sources",
    title: "Connect your work",
    description: "Optional — but the more we see, the more personal your questions get.",
  },
];

type DraftState = "idle" | "saving" | "saved" | "error";

/**
 * Three-step onboarding — Resume → Profile → Sources — beside a live profile preview.
 *
 * Progress survives a refresh and the GitHub OAuth round trip: the profile is saved as a draft
 * (`complete: false`) once the resume is parsed and whenever the Profile step is left, and the
 * current step is remembered per tab. Name and current engineering level are required; the level is preselected from
 * the parsed resume but stays the candidate's own choice.
 */
export function OnboardingWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const form = useCandidateForm(emptyCandidateForm);
  const draft = useSaveCandidateProfile();
  const finishSave = useSaveCandidateProfile();
  const existing = useCandidateProfile();
  const { user } = useCurrentUser();

  // The step the candidate chose (or was on before a reload / OAuth redirect). Until they move,
  // a saved draft starts them on Profile, a fresh account on Resume.
  const [chosenStep, setChosenStep] = useState<number | null>(() => readStep(STEPS.length));
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the form has been seeded (saved draft, parsed resume or manual entry). A ref, not
  // state: it only guards the prefill effect and never affects what renders.
  const seeded = useRef(false);
  // The level we preselected from the resume, if any — shown as a hint while it is still what's chosen.
  const [levelGuess, setLevelGuess] = useState<EngineeringLevel | null>(null);

  // Prefill from a saved draft (e.g. returning mid-onboarding), once.
  useEffect(() => {
    if (!seeded.current && existing.data) {
      form.reset(responseToForm(existing.data));
      seeded.current = true;
    }
  }, [existing.data, form]);

  // The name and email given at sign-up fill any blank, so nobody types them twice.
  useEffect(() => {
    if (!user || existing.isLoading) return;
    if (!form.getValues("fullName").trim() && user.name?.trim()) form.setValue("fullName", user.name.trim());
    if (!form.getValues("email").trim() && user.email) form.setValue("email", user.email);
  }, [user, existing.isLoading, existing.data, form]);

  const [resumeFilename, resumeLinkedInUrl, level] = useWatch({
    control: form.control,
    name: ["resumeFilename", "detectedLinks.linkedin", "level"],
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
    const parsedForm = responseToForm(parsed);
    // Preselect a level only when nothing was chosen yet, or the choice is still our earlier guess.
    const chosen = form.getValues("level");
    const guess = guessLevelFromResume(parsedForm.experience, parsedForm.education);
    const keep = chosen !== "" && chosen !== levelGuess;
    form.reset({
      ...parsedForm,
      fullName: parsedForm.fullName || form.getValues("fullName"),
      email: parsedForm.email || form.getValues("email"),
      level: keep ? chosen : (guess ?? chosen),
    });
    setLevelGuess(keep ? null : guess);
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

  const finish = () =>
    form.handleSubmit(
      (values) => {
        finishSave.mutate(formToRequest(values, true), {
          onSuccess: () => {
            clearStep();
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
        goTo(PROFILE);
        toast.error("Please complete the required fields.");
      },
    )();

  if (existing.isLoading) return <WizardSkeleton />;

  const copy = COPY[step];
  const busy = draft.isPending || finishSave.isPending;
  const preview = { control: form.control, target: null };
  const nextLabel =
    step === LAST ? "Finish" : step === 0 && !hasResume ? "Continue without resume" : "Continue";

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
                      <PersonalFields showTargetRole={false} levelHint={level && level === levelGuess ? "Suggested from your resume — change it if it isn't right" : undefined} />
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
                    onClick={() => (step === LAST ? void finish() : void next())}
                    disabled={busy}
                  >
                    Skip for now
                  </Button>
                ) : null}
                <DraftStatus state={draftState} />
                <Button
                  type="button"
                  className="ml-auto h-11 gap-2.5 px-[22px]"
                  onClick={() => (step === LAST ? void finish() : void next())}
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
