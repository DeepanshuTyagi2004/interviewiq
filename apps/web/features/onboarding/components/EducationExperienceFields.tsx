"use client";

import {
  AchievementsField,
  EducationFields,
  ExperienceFields,
  ProjectFields,
  SkillsField,
} from "./SectionFields";

/** Onboarding's Profile step: every resume section in one column (the profile page edits them one at a time). */
export function EducationExperienceFields() {
  return (
    <div className="space-y-8">
      <EducationFields />
      <ExperienceFields />
      <ProjectFields />
      <SkillsField />
      <AchievementsField />
    </div>
  );
}
