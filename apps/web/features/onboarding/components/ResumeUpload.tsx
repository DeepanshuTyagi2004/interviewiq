"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ApiFetchError } from "@/lib/api-client/client";
import { RESUME_MAX_BYTES } from "@/lib/constants/onboarding";
import { useResumeParseRun, useStartResumeParse } from "../hooks";
import type { CandidateProfileResponse } from "../types";

const SUCCESS_MSG = "Résumé parsed — your details below have been updated. Review and save.";
const FAIL_MSG = "We couldn't parse that résumé. Please try again or enter your details manually.";

/**
 * Résumé drop-zone. Fire-and-poll: uploading STARTS a background parse (returns immediately), then
 * we poll until it finishes — so a slow LLM can't time out the request. On completion it hands the
 * draft up; on failure it shows the backend's message. `compact` trims copy for the profile-edit
 * "Replace résumé" affordance.
 */
export function ResumeUpload({
  onParsed,
  onSkip,
  compact = false,
  successMessage = SUCCESS_MSG,
}: {
  onParsed: (draft: CandidateProfileResponse) => void;
  onSkip?: () => void;
  compact?: boolean;
  /** Banner copy on a successful parse — override where there are no "fields below" to review. */
  successMessage?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null); // pre-flight/start errors
  const [runId, setRunId] = useState<string | null>(null);
  const filenameRef = useRef<string>(""); // uploaded name, stamped onto the completed draft
  const handledRef = useRef<string | null>(null); // fire onParsed for a terminal run only once
  const start = useStartResumeParse();
  const run = useResumeParseRun(runId);

  const runStatus = run.data?.status;
  const busy = start.isPending || (!!runId && runStatus !== "completed" && runStatus !== "failed");

  // Fire the parent callback / toast exactly once when a run reaches a terminal state. Only prop
  // calls + toasts here (no setState) — the banner and busy flag are derived in render below.
  useEffect(() => {
    if (!runId || !run.data || handledRef.current === runId) return;
    if (run.data.status === "completed" && run.data.profile) {
      handledRef.current = runId;
      toast.success("Résumé parsed — review your details below.");
      onParsed({
        ...run.data.profile,
        resumeFilename: filenameRef.current || run.data.profile.resumeFilename,
      });
    } else if (run.data.status === "failed") {
      handledRef.current = runId;
      toast.error(run.data.error ?? FAIL_MSG);
    }
  }, [runId, run.data, onParsed]);

  const banner: { kind: "success" | "error"; message: string } | null = localError
    ? { kind: "error", message: localError }
    : runStatus === "completed"
      ? { kind: "success", message: successMessage }
      : runStatus === "failed"
        ? { kind: "error", message: run.data?.error ?? FAIL_MSG }
        : null;

  function handleFile(file: File | undefined) {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setLocalError("Please upload a PDF résumé.");
      toast.error("Please upload a PDF résumé.");
      return;
    }
    if (file.size > RESUME_MAX_BYTES) {
      setLocalError("The résumé must be 6 MB or smaller.");
      toast.error("The résumé must be 6 MB or smaller.");
      return;
    }
    setLocalError(null);
    filenameRef.current = file.name;
    start.mutate(file, {
      onSuccess: ({ run_id }) => setRunId(run_id),
      onError: (err) => {
        const message =
          err instanceof ApiFetchError
            ? err.message
            : "We couldn't start parsing that résumé. Please try again or enter your details manually.";
        setLocalError(message);
        toast.error(message);
      },
    });
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center transition-colors",
          compact ? "p-6" : "p-10",
          dragging && "border-primary bg-accent",
          busy && "pointer-events-none opacity-70",
        )}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {busy
              ? "Reading your résumé — this can take a minute…"
              : compact
                ? "Upload a new résumé (PDF)"
                : "Drag & drop your résumé, or click to browse"}
          </p>
          {!compact ? (
            <p className="text-xs text-muted-foreground">PDF only, up to 6 MB</p>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </div>

      {banner ? (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            banner.kind === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {banner.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{banner.message}</span>
        </div>
      ) : null}

      {onSkip ? (
        <div className="flex justify-center">
          <Button type="button" variant="ghost" onClick={onSkip} disabled={busy}>
            Skip and enter details manually
          </Button>
        </div>
      ) : null}
    </div>
  );
}
