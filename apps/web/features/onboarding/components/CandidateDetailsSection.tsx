"use client";

import { useEffect, useState } from "react";
import { FormProvider } from "react-hook-form";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Section, SectionLabel, EmptyState } from "@/components/patterns";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import type { CandidateProfileResponse } from "../types";
import { PersonalFields } from "./PersonalFields";
import { EducationExperienceFields } from "./EducationExperienceFields";
import { ResumeUpload } from "./ResumeUpload";

/** "Personal details" block on the profile page: read-only view + inline edit + change-résumé. */
export function CandidateDetailsSection() {
  const { data, isLoading } = useCandidateProfile();
  const save = useSaveCandidateProfile();
  const form = useCandidateForm(emptyCandidateForm);
  const [editing, setEditing] = useState(false);

  // Keep the form in sync with the loaded profile whenever we (re)enter view mode.
  useEffect(() => {
    if (data && !editing) form.reset(responseToForm(data));
  }, [data, editing, form]);

  if (isLoading) {
    return (
      <Section title="Personal details">
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </Section>
    );
  }

  const startEdit = () => {
    form.reset(data ? responseToForm(data) : emptyCandidateForm);
    setEditing(true);
  };

  const onSave = form.handleSubmit((values) => {
    save.mutate(formToRequest(values, false), {
      onSuccess: () => {
        toast.success("Details saved.");
        setEditing(false);
      },
      onError: () => toast.error("Couldn't save your details. Please try again."),
    });
  });

  if (editing) {
    return (
      <Section title="Personal details">
        <FormProvider {...form}>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
            <PersonalFields />
            <EducationExperienceFields />

            <div className="space-y-2">
              <SectionLabel>Replace résumé</SectionLabel>
              <ResumeUpload
                compact
                onParsed={(draft) => {
                  form.reset(responseToForm(draft));
                  toast.success("Résumé re-parsed — review and save.");
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-6">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={onSave} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save details"}
              </Button>
            </div>
          </form>
        </FormProvider>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title="Personal details">
        <EmptyState
          title="No details yet"
          hint="Add your personal details, education and experience."
          action={<Button onClick={startEdit}>Add details</Button>}
        />
      </Section>
    );
  }

  return (
    <Section title="Personal details">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          {data.fullName ? <p className="text-lg font-medium">{data.fullName}</p> : null}
          {data.headline ? <p className="text-sm text-muted-foreground">{data.headline}</p> : null}
          <ContactLine profile={data} />
        </div>
        <Button variant="outline" size="sm" onClick={startEdit}>
          <Pencil /> Edit
        </Button>
      </div>

      {data.education.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Education</SectionLabel>
          {data.education.map((e, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <p className="font-medium">{[e.degree, e.field].filter(Boolean).join(", ") || "—"}</p>
                <p className="text-sm text-muted-foreground">
                  {[e.institution, [e.startYear, e.endYear].filter(Boolean).join("–")]
                    .filter(Boolean)
                    .join(" · ")}
                  {e.grade ? ` · ${e.grade}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {data.experience.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Experience</SectionLabel>
          {data.experience.map((x, i) => (
            <Card key={i}>
              <CardContent className="space-y-2 p-4">
                <div>
                  <p className="font-medium">{[x.title, x.company].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {[[x.startDate, x.endDate].filter(Boolean).join(" – "), x.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {x.bullets.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {x.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {data.projects.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Projects</SectionLabel>
          {data.projects.map((p, i) => (
            <Card key={i}>
              <CardContent className="space-y-2 p-4">
                <div>
                  <p className="font-medium">{p.name || "—"}</p>
                  {p.description ? (
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                  ) : null}
                  {p.tech.length > 0 ? (
                    <p className="text-xs text-muted-foreground">{p.tech.join(" · ")}</p>
                  ) : null}
                </div>
                {p.bullets.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {p.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {data.skills.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Skills</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {data.skills.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {data.achievements.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Achievements</SectionLabel>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {data.achievements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function ContactLine({ profile }: { profile: CandidateProfileResponse }) {
  const parts = [profile.email, profile.phone, profile.location].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}
