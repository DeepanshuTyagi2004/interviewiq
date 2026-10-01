"use client";

import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, SectionLabel } from "@/components/patterns";
import { SkillsInput } from "./SkillsInput";
import {
  emptyEducationRow,
  emptyExperienceRow,
  emptyProjectRow,
  type CandidateFormValues,
} from "../form";

/** Step 2 fields (also reused in profile edit): education/experience/project rows + skills + achievements. */
export function EducationExperienceFields() {
  const { register, control } = useFormContext<CandidateFormValues>();
  const education = useFieldArray({ control, name: "education" });
  const experience = useFieldArray({ control, name: "experience" });
  const projects = useFieldArray({ control, name: "projects" });

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Education</SectionLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => education.append(emptyEducationRow)}
          >
            <Plus /> Add
          </Button>
        </div>
        {education.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No education added yet.</p>
        ) : null}
        {education.fields.map((row, i) => (
          <Card key={row.id}>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Institution">
                  <Input {...register(`education.${i}.institution`)} />
                </FormField>
                <FormField label="Degree">
                  <Input {...register(`education.${i}.degree`)} />
                </FormField>
                <FormField label="Field of study">
                  <Input {...register(`education.${i}.field`)} />
                </FormField>
                <FormField label="Grade / CGPA">
                  <Input {...register(`education.${i}.grade`)} />
                </FormField>
                <FormField label="Start year">
                  <Input {...register(`education.${i}.startYear`)} />
                </FormField>
                <FormField label="End year">
                  <Input {...register(`education.${i}.endYear`)} />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => education.remove(i)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Experience</SectionLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => experience.append(emptyExperienceRow)}
          >
            <Plus /> Add
          </Button>
        </div>
        {experience.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No experience added yet.</p>
        ) : null}
        {experience.fields.map((row, i) => (
          <Card key={row.id}>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Company">
                  <Input {...register(`experience.${i}.company`)} />
                </FormField>
                <FormField label="Title">
                  <Input {...register(`experience.${i}.title`)} />
                </FormField>
                <FormField label="Start">
                  <Input placeholder="Jun 2024" {...register(`experience.${i}.startDate`)} />
                </FormField>
                <FormField label="End">
                  <Input placeholder="Present" {...register(`experience.${i}.endDate`)} />
                </FormField>
                <FormField label="Location" className="sm:col-span-2">
                  <Input {...register(`experience.${i}.location`)} />
                </FormField>
              </div>
              <FormField label="Highlights" hint="One per line">
                <Textarea rows={3} {...register(`experience.${i}.bulletsText`)} />
              </FormField>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => experience.remove(i)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionLabel>Projects</SectionLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => projects.append(emptyProjectRow)}
          >
            <Plus /> Add
          </Button>
        </div>
        {projects.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects added yet.</p>
        ) : null}
        {projects.fields.map((row, i) => (
          <Card key={row.id}>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Name">
                  <Input {...register(`projects.${i}.name`)} />
                </FormField>
                <FormField label="Link">
                  <Input placeholder="github.com/…" {...register(`projects.${i}.link`)} />
                </FormField>
                <FormField label="Description" className="sm:col-span-2">
                  <Input placeholder="One-line summary" {...register(`projects.${i}.description`)} />
                </FormField>
                <FormField label="Tech" className="sm:col-span-2" hint="Comma-separated">
                  <Input placeholder="Next.js, Postgres, Redis" {...register(`projects.${i}.techText`)} />
                </FormField>
              </div>
              <FormField label="Highlights" hint="One per line">
                <Textarea rows={3} {...register(`projects.${i}.bulletsText`)} />
              </FormField>
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => projects.remove(i)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <SectionLabel>Skills</SectionLabel>
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

      <div className="space-y-4">
        <SectionLabel>Achievements</SectionLabel>
        <FormField label="Achievements" htmlFor="achievementsText" hint="One per line">
          <Textarea
            id="achievementsText"
            rows={3}
            placeholder="Smart India Hackathon 2024 finalist"
            {...register("achievementsText")}
          />
        </FormField>
      </div>
    </div>
  );
}
