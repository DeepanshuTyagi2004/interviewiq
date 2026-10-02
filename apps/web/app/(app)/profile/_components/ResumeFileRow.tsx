"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { HudCard } from "@/components/hud";
import { ResumeUpload } from "@/features/onboarding/components/ResumeUpload";
import { sourceDate } from "@/app/(app)/connections/_components/format";
import { useResumeImport } from "@/app/(app)/connections/_components/useResumeImport";

/**
 * The design's resume file row: file name, when it was parsed, and Replace. Replacing runs the same
 * import as the Resume source on Connections (parse, then save to the profile). The upload zone
 * stays mounted once opened so a parse that's still running finishes and saves.
 */
export function ResumeFileRow() {
  const { profile, hasProfile, importDraft } = useResumeImport();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelId = useId();

  const parsed = sourceDate(profile?.resumeParsedAt);
  const filename = profile?.resumeFilename;

  return (
    <HudCard as="section" aria-label="Resume" className="rounded-[14px] border border-line-2 bg-card px-5 py-[18px]">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span
          aria-hidden
          className="flex h-11 w-[38px] flex-none items-center justify-center rounded-[8px] border border-line-3 font-mono text-[10px] text-faint"
        >
          PDF
        </span>
        <div className="min-w-[7rem] flex-1">
          <p className="m-0 truncate text-sm">{filename ?? (hasProfile ? "Resume details added" : "No resume yet")}</p>
          <p className="m-0 mt-0.5 text-xs text-faint">
            {filename ? (parsed ? `Parsed ${parsed}` : "Parsed") : "Upload a PDF and we’ll fill in your details"}
          </p>
        </div>
        <Button
          type="button"
          variant={open ? "ghost" : filename || hasProfile ? "outline" : "ink"}
          size="sm"
          className="ml-auto min-w-[84px]"
          onClick={() => {
            setMounted(true);
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-controls={mounted ? panelId : undefined}
        >
          {open ? "Close" : filename || hasProfile ? "Replace" : "Upload"}
        </Button>
      </div>
      {mounted ? (
        <div id={panelId} hidden={!open} className="mt-4 space-y-2">
          <ResumeUpload
            compact
            successMessage="Resume saved to your profile. Your details below are up to date."
            onParsed={importDraft}
          />
          <p className="m-0 text-xs leading-[1.5] text-faint">
            A new resume replaces the details on your profile with what we read from it. You can edit them afterwards.
          </p>
        </div>
      ) : null}
    </HudCard>
  );
}
