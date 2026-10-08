"use client";

import { createContext, useContext, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  emptyCandidateForm,
  emptyEducationRow,
  emptyExperienceRow,
  emptyProjectRow,
  formToRequest,
  responseToForm,
  useCandidateForm,
  useCandidateProfile,
  useSaveCandidateProfile,
  type CandidateFormValues,
  type CandidateProfileResponse,
} from "@/features/onboarding";

export type SectionKey = "contact" | "education" | "experience" | "projects" | "skills" | "achievements";

export const SECTION_LABEL: Record<SectionKey, string> = {
  contact: "Contact",
  education: "Education",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  achievements: "Achievements",
};

/** The form fields each section owns — saving a section validates only these. */
const SECTION_FIELDS: Record<SectionKey, FieldPath<CandidateFormValues>[]> = {
  contact: ["fullName", "email", "phone", "location", "headline", "targetRole", "level"],
  education: ["education"],
  experience: ["experience"],
  projects: ["projects"],
  skills: ["skillsText"],
  achievements: ["achievementsText"],
};

interface DetailsContextValue {
  profile: CandidateProfileResponse | null;
  isLoading: boolean;
  form: UseFormReturn<CandidateFormValues>;
  /** The one section being edited, or null. */
  editing: SectionKey | null;
  isDirty: boolean;
  saving: boolean;
  /** Edit a section. `seed` starts an empty list section with one blank row (its "Add" button). */
  open: (section: SectionKey, opts?: { seed?: boolean }) => void;
  cancel: () => void;
  save: () => Promise<void>;
}

const DetailsContext = createContext<DetailsContextValue | null>(null);

export function useDetails(): DetailsContextValue {
  const ctx = useContext(DetailsContext);
  if (!ctx) throw new Error("useDetails must be used inside <DetailsProvider>");
  return ctx;
}

function seeded(values: CandidateFormValues, section: SectionKey): CandidateFormValues {
  if (section === "education" && values.education.length === 0) return { ...values, education: [emptyEducationRow] };
  if (section === "experience" && values.experience.length === 0) return { ...values, experience: [emptyExperienceRow] };
  if (section === "projects" && values.projects.length === 0) return { ...values, projects: [emptyProjectRow] };
  return values;
}

/**
 * Editing state for the profile's resume sections. One react-hook-form instance holds the whole
 * profile; each section card edits its own slice, and saving sends the whole profile (the other
 * sections unchanged) through the same PUT as onboarding. Only one section is open at a time —
 * switching away from unsaved changes asks first.
 */
export function DetailsProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useCandidateProfile();
  const saveProfile = useSaveCandidateProfile();
  const form = useCandidateForm(emptyCandidateForm);
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [switchTo, setSwitchTo] = useState<{ section: SectionKey; seed: boolean } | null>(null);
  // Read during render so react-hook-form subscribes to it.
  const { isDirty } = form.formState;
  const profile = data ?? null;

  const begin = (section: SectionKey, seed: boolean) => {
    const values = profile ? responseToForm(profile) : emptyCandidateForm;
    form.reset(seed ? seeded(values, section) : values);
    setEditing(section);
  };

  const open: DetailsContextValue["open"] = (section, opts) => {
    if (editing === section) return;
    if (editing && isDirty) {
      setSwitchTo({ section, seed: Boolean(opts?.seed) });
      return;
    }
    begin(section, Boolean(opts?.seed));
  };

  const cancel = () => setEditing(null);

  const save = async () => {
    const section = editing;
    if (!section) return;
    if (!(await form.trigger(SECTION_FIELDS[section]))) return;
    const request = formToRequest(form.getValues(), false);
    if (profile) {
      // Preserve untouched wire values, especially unknown (null) parsed arrays.
      if (section !== "education") request.education = profile.education;
      if (section !== "experience") request.experience = profile.experience;
      if (section !== "projects") request.projects = profile.projects;
      if (section !== "skills") request.skills = profile.skills;
      if (section !== "achievements") request.achievements = profile.achievements;
      if (section !== "contact") {
        request.fullName = profile.fullName;
        request.email = profile.email;
        request.phone = profile.phone;
        request.location = profile.location;
        request.headline = profile.headline;
        request.targetRole = profile.targetRole;
        request.portfolioWebsite = profile.portfolioWebsite ?? profile.detectedLinks?.portfolioWebsite ?? null;
      }
      request.targetJdId = profile.targetJdId;
      request.detectedLinks = profile.detectedLinks;
      request.resumeFilename = profile.resumeFilename;
    }
    // Only Contact edits the user's level. Omission preserves the saved choice (including
    // unknown legacy metadata) when another section is saved or a background read changes.
    if (section !== "contact") delete request.level;
    saveProfile.mutate(request, {
      onSuccess: () => {
        toast.success(`${SECTION_LABEL[section]} saved.`);
        setEditing(null);
      },
      onError: () => toast.error("Couldn't save your changes. Please try again."),
    });
  };

  const value: DetailsContextValue = {
    profile,
    isLoading,
    form,
    editing,
    isDirty,
    saving: saveProfile.isPending,
    open,
    cancel,
    save,
  };

  return (
    <DetailsContext.Provider value={value}>
      {children}
      <Dialog open={switchTo !== null} onOpenChange={(o) => (o ? null : setSwitchTo(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-normal">
              Discard changes to {editing ? SECTION_LABEL[editing] : "this section"}?
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes. Discard them to edit {switchTo ? SECTION_LABEL[switchTo.section] : "another section"}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSwitchTo(null)}>
              Keep editing
            </Button>
            <Button
              variant="ink"
              onClick={() => {
                if (switchTo) begin(switchTo.section, switchTo.seed);
                setSwitchTo(null);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DetailsContext.Provider>
  );
}
