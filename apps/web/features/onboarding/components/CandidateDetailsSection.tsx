"use client";

import { useEffect, useId, useState } from "react";
import { FormProvider } from "react-hook-form";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoPill, SectionLabel } from "@/components/patterns";
import { emptyCandidateForm, useCandidateForm } from "../form";
import { responseToForm, formToRequest } from "../mapping";
import { useCandidateProfile, useSaveCandidateProfile } from "../hooks";
import type { CandidateProfileResponse } from "../types";
import { PersonalFields } from "./PersonalFields";
import { EducationExperienceFields } from "./EducationExperienceFields";
import { ResumeUpload } from "./ResumeUpload";

/** Bordered card with the design's title row; the profile page's "Personal details". */
function DetailsCard({
  action,
  editing = false,
  children,
}: {
  action?: React.ReactNode;
  editing?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-[10px] border border-line-2 bg-card">
      <div className="flex min-h-[53px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={id} className="m-0 text-sm font-normal">
          Personal details
        </h2>
        {editing ? <MonoPill tone="brand">Editing</MonoPill> : null}
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled block of the read-only view: label on the left from `sm`, content on the right. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2.5 px-4 py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-5 sm:px-5 sm:py-5">
      <p className="iq-eyebrow m-0 pt-0.5">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px] leading-[1.5] text-muted-foreground">
      {items.map((b, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-[8px] h-1 w-1 flex-none rounded-full bg-faint-2" />
          <span className="min-w-0">{b}</span>
        </li>
      ))}
    </ul>
  );
}

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
      <DetailsCard>
        <div className="flex flex-col gap-3 p-4 sm:p-5" aria-busy="true" aria-label="Loading your details">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </DetailsCard>
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
      <DetailsCard editing>
        <FormProvider {...form}>
          <form onSubmit={(e) => e.preventDefault()} className="flex flex-col">
            <div className="flex flex-col gap-8 px-4 py-5 sm:px-5">
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
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line bg-panel/60 px-4 py-3.5 sm:px-5">
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={onSave} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save details"}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DetailsCard>
    );
  }

  if (!data) {
    return (
      <DetailsCard>
        <div className="flex flex-col items-start gap-1.5 px-4 py-6 sm:px-5">
          <p className="m-0 text-sm">No details yet</p>
          <p className="m-0 max-w-md text-[13px] leading-[1.5] text-muted-foreground">
            Add your personal details, education and experience.
          </p>
          <div className="pt-2">
            <Button size="sm" onClick={startEdit}>
              Add details
            </Button>
          </div>
        </div>
      </DetailsCard>
    );
  }

  return (
    <DetailsCard
      action={
        <Button variant="outline" size="sm" onClick={startEdit}>
          <Pencil aria-hidden /> Edit
        </Button>
      }
    >
      <div className="divide-y divide-line">
        <Block label="Contact">
          <ContactList profile={data} />
        </Block>

        {data.education.length > 0 ? (
          <Block label="Education">
            <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
              {data.education.map((e, i) => (
                <li key={i}>
                  <p className="m-0 text-sm">{[e.degree, e.field].filter(Boolean).join(", ") || "—"}</p>
                  <p className="m-0 mt-0.5 text-[12.5px] text-faint">
                    {[e.institution, [e.startYear, e.endYear].filter(Boolean).join("–"), e.grade]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {data.experience.length > 0 ? (
          <Block label="Experience">
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {data.experience.map((x, i) => (
                <li key={i}>
                  <p className="m-0 text-sm">{[x.title, x.company].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="m-0 mt-0.5 text-[12.5px] text-faint">
                    {[[x.startDate, x.endDate].filter(Boolean).join(" – "), x.location].filter(Boolean).join(" · ")}
                  </p>
                  <Bullets items={x.bullets} />
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {data.projects.length > 0 ? (
          <Block label="Projects">
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {data.projects.map((p, i) => (
                <li key={i}>
                  <p className="m-0 text-sm">{p.name || "—"}</p>
                  {p.description ? (
                    <p className="m-0 mt-0.5 text-[13px] leading-[1.5] text-muted-foreground">{p.description}</p>
                  ) : null}
                  {p.tech.length > 0 ? (
                    <p className="m-0 mt-1 font-mono text-[11.5px] text-faint">{p.tech.join(" · ")}</p>
                  ) : null}
                  <Bullets items={p.bullets} />
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {data.skills.length > 0 ? (
          <Block label="Skills">
            <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0">
              {data.skills.map((s) => (
                <li key={s} className="rounded bg-panel px-2 py-[3px] text-xs">
                  {s}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {data.achievements.length > 0 ? (
          <Block label="Achievements">
            <Bullets items={data.achievements} />
          </Block>
        ) : null}
      </div>
    </DetailsCard>
  );
}

function ContactList({ profile }: { profile: CandidateProfileResponse }) {
  const rows: [string, string | null][] = [
    ["Name", profile.fullName],
    ["Headline", profile.headline],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["Location", profile.location],
    ["Target role", profile.targetRole],
  ];
  const shown = rows.filter(([, v]) => Boolean(v?.trim()));
  if (shown.length === 0) {
    return <p className="m-0 text-[13px] text-muted-foreground">No contact details yet.</p>;
  }
  return (
    <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-faint">{label}</dt>
          <dd className="m-0 min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
