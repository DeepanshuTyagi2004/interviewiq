"use client";

import { useEffect, useRef } from "react";
import { FormProvider } from "react-hook-form";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoPill } from "@/components/patterns";
import { ProfileCard } from "../ProfileCard";
import { SECTION_LABEL, useDetails, type SectionKey } from "./DetailsProvider";

export interface EditableSectionProps {
  section: SectionKey;
  /** Shown beside the title (e.g. how many roles). Omitted for 0. */
  count?: number;
  isEmpty: boolean;
  /** One line shown, with an Add button, when the section has nothing yet. */
  emptyHint: string;
  /** The read-only view. */
  children: React.ReactNode;
  /** The section's form fields (read the shared form context). */
  fields: React.ReactNode;
  className?: string;
}

/**
 * A profile section card: read-only view with its own Edit, or — while it's the open section —
 * its form with Save / Cancel. Focus moves into the form on edit and back to Edit afterwards.
 */
export function EditableSection({ section, count, isEmpty, emptyHint, children, fields, className }: EditableSectionProps) {
  const { isLoading, form, editing, isDirty, saving, open, cancel, save } = useDetails();
  const isEditing = editing === section;
  const label = SECTION_LABEL[section];
  const bodyRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (isEditing && !wasEditing.current) {
      bodyRef.current?.querySelector<HTMLElement>("input, textarea, [contenteditable=true]")?.focus();
    } else if (!isEditing && wasEditing.current && editing === null) {
      // Closed (saved or cancelled) — not switched to another section, which takes focus itself.
      editRef.current?.focus();
    }
    wasEditing.current = isEditing;
  }, [isEditing, editing]);

  const meta = isEditing ? (
    <MonoPill tone="brand">Editing</MonoPill>
  ) : count ? (
    <span aria-label={`${count} ${count === 1 ? "entry" : "entries"}`}>{count}</span>
  ) : undefined;

  const action =
    isEditing || isLoading || isEmpty ? undefined : (
      <Button ref={editRef} variant="outline" size="sm" onClick={() => open(section)} aria-label={`Edit ${label.toLowerCase()}`}>
        <Pencil aria-hidden /> Edit
      </Button>
    );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="flex flex-col gap-2.5 px-4 py-4 sm:px-5" aria-busy="true" aria-label={`Loading ${label.toLowerCase()}`}>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    );
  } else if (isEditing) {
    body = (
      <FormProvider {...form}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            // Escape closes an untouched form; with changes, Cancel is the deliberate way out.
            if (e.key === "Escape" && !saving && !isDirty) cancel();
          }}
        >
          <div ref={bodyRef} className="px-4 py-5 sm:px-5">
            {fields}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel/60 px-4 py-3 sm:px-5">
            <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !isDirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </FormProvider>
    );
  } else if (isEmpty) {
    body = (
      <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
        <p className="m-0 min-w-0 flex-1 text-[13px] leading-[1.5] text-muted-foreground">{emptyHint}</p>
        <Button
          ref={editRef}
          variant="outline"
          size="sm"
          className="flex-none"
          onClick={() => open(section, { seed: true })}
          aria-label={`Add ${label.toLowerCase()}`}
        >
          <Plus aria-hidden /> Add
        </Button>
      </div>
    );
  } else {
    body = children;
  }

  return (
    <ProfileCard title={label} meta={meta} action={action} className={className}>
      {body}
    </ProfileCard>
  );
}
