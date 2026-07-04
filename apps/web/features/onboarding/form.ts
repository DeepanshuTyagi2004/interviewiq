"use client";

import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

/**
 * Form-side shape of the candidate profile. It deliberately differs from the API DTOs in two
 * spots for editing ergonomics: résumé bullets are edited as a single multiline string
 * (`bulletsText`, one per line) and skills as one comma-separated string (`skillsText`). The
 * mapping module converts to/from the API's arrays. All fields are plain strings (never null) so
 * inputs stay controlled; the mapping trims empties back to null on save.
 */

// Email is optional, but if present it must look like an email. `.refine` (not zod's format
// helper) keeps this valid across zod versions.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const educationRowSchema = z.object({
  institution: z.string(),
  degree: z.string(),
  field: z.string(),
  startYear: z.string(),
  endYear: z.string(),
  grade: z.string(),
});

const experienceRowSchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  bulletsText: z.string(),
});

const projectRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  techText: z.string(), // comma-separated
  bulletsText: z.string(), // one per line
  link: z.string(),
});

export const candidateFormSchema = z.object({
  fullName: z.string().min(1, "Your name is required"),
  email: z.string().refine((v) => v === "" || EMAIL_RE.test(v), "Enter a valid email"),
  phone: z.string(),
  location: z.string(),
  headline: z.string(),
  targetRole: z.string(),
  education: z.array(educationRowSchema),
  experience: z.array(experienceRowSchema),
  projects: z.array(projectRowSchema),
  skillsText: z.string(),
  achievementsText: z.string(), // one per line
  detectedLinks: z.object({
    github: z.string(),
    leetcode: z.string(),
    linkedin: z.string(),
  }),
  resumeFilename: z.string().nullable(),
});

export type CandidateFormValues = z.infer<typeof candidateFormSchema>;
export type EducationRow = z.infer<typeof educationRowSchema>;
export type ExperienceRow = z.infer<typeof experienceRowSchema>;
export type ProjectRow = z.infer<typeof projectRowSchema>;

export const emptyEducationRow: EducationRow = {
  institution: "",
  degree: "",
  field: "",
  startYear: "",
  endYear: "",
  grade: "",
};

export const emptyExperienceRow: ExperienceRow = {
  company: "",
  title: "",
  startDate: "",
  endDate: "",
  location: "",
  bulletsText: "",
};

export const emptyProjectRow: ProjectRow = {
  name: "",
  description: "",
  techText: "",
  bulletsText: "",
  link: "",
};

export const emptyCandidateForm: CandidateFormValues = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  headline: "",
  targetRole: "",
  education: [],
  experience: [],
  projects: [],
  skillsText: "",
  achievementsText: "",
  detectedLinks: { github: "", leetcode: "", linkedin: "" },
  resumeFilename: null,
};

export function useCandidateForm(
  defaultValues: CandidateFormValues,
): UseFormReturn<CandidateFormValues> {
  return useForm<CandidateFormValues>({
    resolver: zodResolver(candidateFormSchema),
    defaultValues,
    mode: "onBlur",
  });
}
