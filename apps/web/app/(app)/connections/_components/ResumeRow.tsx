"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonoPill } from "@/components/patterns";
import { ROUTES } from "@/lib/constants/shared";
import { ResumeUpload } from "@/features/onboarding/components/ResumeUpload";
import { joinDetail, sourceDate } from "./format";
import { SourceRow, type SourceRowVariant } from "./SourceRow";
import { useResumeImport } from "./useResumeImport";
import type { ProviderMeta } from "./providers";

/**
 * Resume "connection": upload a PDF → parse it (async fire-and-poll, so a slow model can't time
 * out) → save the result to the candidate profile. Unlike GitHub/LeetCode this isn't an OAuth/paste
 * link — it's a one-shot import that populates the profile, which the user can then edit on Profile.
 *
 * The upload zone opens under the row. Once opened it stays mounted (only hidden when closed) so a
 * parse that's still running keeps polling and saves when it finishes.
 */
export function ResumeRow({
  provider,
  variant = "stack",
}: {
  provider: ProviderMeta;
  variant?: SourceRowVariant;
}) {
  const { profile, hasProfile, importDraft } = useResumeImport();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelId = useId();

  const parsed = sourceDate(profile?.resumeParsedAt);
  const detail = profile?.resumeFilename
    ? joinDetail([profile.resumeFilename, parsed ? `parsed ${parsed}` : "parsed"])
    : hasProfile
      ? "Details added to your profile"
      : provider.description;

  function toggle() {
    setMounted(true);
    setOpen((o) => !o);
  }

  return (
    <SourceRow
      variant={variant}
      bodyId={panelId}
      bodyHidden={!open}
      code={provider.code}
      name={provider.label}
      detail={detail}
      connected={hasProfile}
      pill={hasProfile ? <MonoPill tone="soft">Parsed</MonoPill> : null}
      actions={
        <Button
          type="button"
          variant={open ? "ghost" : hasProfile ? "strong" : "ink"}
          size="sm"
          className="min-w-[96px]"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={mounted ? panelId : undefined}
        >
          {open ? "Close" : hasProfile ? "Replace" : "Upload"}
        </Button>
      }
    >
      {mounted ? (
        <div className="space-y-3">
          <ResumeUpload
            compact
            successMessage="Resume saved to your profile — review or edit it on your Profile page."
            onParsed={importDraft}
          />
          {hasProfile ? (
            <Link
              href={ROUTES.profile}
              className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Review on your profile
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </SourceRow>
  );
}
