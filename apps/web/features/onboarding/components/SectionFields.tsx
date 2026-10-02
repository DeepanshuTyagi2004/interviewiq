"use client";

import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, SectionLabel } from "@/components/patterns";
import { SkillsInput } from "./SkillsInput";
import { HighlightsEditor } from "./HighlightsEditor";
import {
  emptyEducationRow,
  emptyExperienceRow,
  emptyProjectRow,
  type CandidateFormValues,
} from "../form";

/**
 * The profile's editable sections, one component each, all reading the shared react-hook-form
 * context. Onboarding renders them together (EducationExperienceFields); the profile page edits one
 * at a time inside that section's card, where the card already carries the title — so `heading`
 * is off there and the Add button moves under the rows.
 */
export interface SectionFieldsProps {
  /** Show the section label + Add button row on top (onboarding). Off inside a titled card. */
  heading?: boolean;
}

const HIGHLIGHTS_HINT = "One line per point · - bullets, 1. numbers, **bold** · Tab nests a point";

/** Label + Add on top (heading) or a lone Add under the rows (inside a card), plus the empty note. */
function RowList({
  label,
  addLabel,
  emptyText,
  count,
  heading,
  onAdd,
  children,
}: {
  label: string;
  addLabel: string;
  emptyText: string;
  count: number;
  heading: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const add = (
    <Button type="button" variant="outline" size="sm" onClick={onAdd}>
      <Plus /> {heading ? "Add" : addLabel}
    </Button>
  );
  return (
    <div className="space-y-4">
      {heading ? (
        <div className="flex items-center justify-between">
          <SectionLabel>{label}</SectionLabel>
          {add}
        </div>
      ) : null}
      {count === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null}
      {children}
      {heading ? null : <div>{add}</div>}
    </div>
  );
}

function RemoveRow({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="flex justify-end">
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 /> Remove
      </Button>
    </div>
  );
}

export function EducationFields({ heading = true }: SectionFieldsProps) {
  const { register, control } = useFormContext<CandidateFormValues>();
  const education = useFieldArray({ control, name: "education" });
  return (
    <RowList
      label="Education"
      addLabel="Add education"
      emptyText="No education added yet."
      count={education.fields.length}
      heading={heading}
      onAdd={() => education.append(emptyEducationRow)}
    >
      {education.fields.map((row, i) => (
        <Card key={row.id}>
          <CardContent className="iq-fields space-y-3 p-4">
            <div className="iq-grid" data-cols="3">
              <FormField label="Institution" htmlFor={`education-${i}-institution`}>
                <Input id={`education-${i}-institution`} {...register(`education.${i}.institution`)} />
              </FormField>
              <FormField label="Degree" htmlFor={`education-${i}-degree`}>
                <Input id={`education-${i}-degree`} {...register(`education.${i}.degree`)} />
              </FormField>
              <FormField label="Field of study" htmlFor={`education-${i}-field`}>
                <Input id={`education-${i}-field`} {...register(`education.${i}.field`)} />
              </FormField>
              <FormField label="Grade / CGPA" htmlFor={`education-${i}-grade`}>
                <Input id={`education-${i}-grade`} {...register(`education.${i}.grade`)} />
              </FormField>
              <FormField label="Start year" htmlFor={`education-${i}-startYear`}>
                <Input id={`education-${i}-startYear`} {...register(`education.${i}.startYear`)} />
              </FormField>
              <FormField label="End year" htmlFor={`education-${i}-endYear`}>
                <Input id={`education-${i}-endYear`} {...register(`education.${i}.endYear`)} />
              </FormField>
            </div>
            <RemoveRow onRemove={() => education.remove(i)} />
          </CardContent>
        </Card>
      ))}
    </RowList>
  );
}

export function ExperienceFields({ heading = true }: SectionFieldsProps) {
  const { register, control } = useFormContext<CandidateFormValues>();
  const experience = useFieldArray({ control, name: "experience" });
  return (
    <RowList
      label="Experience"
      addLabel="Add role"
      emptyText="No experience added yet."
      count={experience.fields.length}
      heading={heading}
      onAdd={() => experience.append(emptyExperienceRow)}
    >
      {experience.fields.map((row, i) => (
        <Card key={row.id}>
          <CardContent className="iq-fields space-y-3 p-4">
            <div className="iq-grid" data-cols="4">
              <FormField label="Company" htmlFor={`experience-${i}-company`}>
                <Input id={`experience-${i}-company`} {...register(`experience.${i}.company`)} />
              </FormField>
              <FormField label="Title" htmlFor={`experience-${i}-title`}>
                <Input id={`experience-${i}-title`} {...register(`experience.${i}.title`)} />
              </FormField>
              <FormField label="Start" htmlFor={`experience-${i}-startDate`}>
                <Input id={`experience-${i}-startDate`} placeholder="Jun 2024" {...register(`experience.${i}.startDate`)} />
              </FormField>
              <FormField label="End" htmlFor={`experience-${i}-endDate`}>
                <Input id={`experience-${i}-endDate`} placeholder="Present" {...register(`experience.${i}.endDate`)} />
              </FormField>
              <FormField label="Location" htmlFor={`experience-${i}-location`} className="iq-span-2">
                <Input id={`experience-${i}-location`} {...register(`experience.${i}.location`)} />
              </FormField>
            </div>
            <FormField label="Highlights" htmlFor={`experience-${i}-highlights`} hint={HIGHLIGHTS_HINT}>
              <Controller
                control={control}
                name={`experience.${i}.bulletsText`}
                render={({ field }) => (
                  <HighlightsEditor
                    ref={field.ref}
                    id={`experience-${i}-highlights`}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="- Built a **voice agent** handling 10k+ calls/day"
                  />
                )}
              />
            </FormField>
            <RemoveRow onRemove={() => experience.remove(i)} />
          </CardContent>
        </Card>
      ))}
    </RowList>
  );
}

export function ProjectFields({ heading = true }: SectionFieldsProps) {
  const { register, control } = useFormContext<CandidateFormValues>();
  const projects = useFieldArray({ control, name: "projects" });
  return (
    <RowList
      label="Projects"
      addLabel="Add project"
      emptyText="No projects added yet."
      count={projects.fields.length}
      heading={heading}
      onAdd={() => projects.append(emptyProjectRow)}
    >
      {projects.fields.map((row, i) => (
        <Card key={row.id}>
          <CardContent className="iq-fields space-y-3 p-4">
            <div className="iq-grid">
              <FormField label="Name" htmlFor={`projects-${i}-name`}>
                <Input id={`projects-${i}-name`} {...register(`projects.${i}.name`)} />
              </FormField>
              <FormField label="Link" htmlFor={`projects-${i}-link`}>
                <Input id={`projects-${i}-link`} placeholder="github.com/…" {...register(`projects.${i}.link`)} />
              </FormField>
              <FormField label="Description" htmlFor={`projects-${i}-description`} className="iq-span-2-narrow">
                <Input id={`projects-${i}-description`} placeholder="One-line summary" {...register(`projects.${i}.description`)} />
              </FormField>
              <FormField label="Tech" htmlFor={`projects-${i}-techText`} className="iq-span-2-narrow" hint="Comma-separated">
                <Input id={`projects-${i}-techText`} placeholder="Next.js, Postgres, Redis" {...register(`projects.${i}.techText`)} />
              </FormField>
            </div>
            <FormField label="Highlights" htmlFor={`projects-${i}-highlights`} hint={HIGHLIGHTS_HINT}>
              <Controller
                control={control}
                name={`projects.${i}.bulletsText`}
                render={({ field }) => (
                  <HighlightsEditor
                    ref={field.ref}
                    id={`projects-${i}-highlights`}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="- Built a **voice agent** handling 10k+ calls/day"
                  />
                )}
              />
            </FormField>
            <RemoveRow onRemove={() => projects.remove(i)} />
          </CardContent>
        </Card>
      ))}
    </RowList>
  );
}

export function SkillsField({ heading = true }: SectionFieldsProps) {
  const { control } = useFormContext<CandidateFormValues>();
  return (
    <div className="space-y-4">
      {heading ? <SectionLabel>Skills</SectionLabel> : null}
      <FormField label="Skills" htmlFor="skillsText" hint="Click a skill to remove it · Enter or comma to add">
        <Controller
          control={control}
          name="skillsText"
          render={({ field }) => (
            <SkillsInput id="skillsText" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
          )}
        />
      </FormField>
    </div>
  );
}

export function AchievementsField({ heading = true }: SectionFieldsProps) {
  const { register } = useFormContext<CandidateFormValues>();
  return (
    <div className="space-y-4">
      {heading ? <SectionLabel>Achievements</SectionLabel> : null}
      <FormField label="Achievements" htmlFor="achievementsText" hint="One per line">
        <Textarea
          id="achievementsText"
          rows={3}
          placeholder="Smart India Hackathon 2024 finalist"
          {...register("achievementsText")}
        />
      </FormField>
    </div>
  );
}
