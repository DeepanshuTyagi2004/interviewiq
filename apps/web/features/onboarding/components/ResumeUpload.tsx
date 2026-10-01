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
  const [filename, setFilename] = useState(""); // same name, for display
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
    setFilename(file.name);
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
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[10px] text-center transition-colors duration-200 hover:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          compact ? "border border-dashed border-line-4 bg-card p-6" : "min-h-[220px] border-[1.5px] border-dashed bg-panel p-7",
          !compact && (runStatus === "completed" ? "border-foreground" : "border-line-4"),
          dragging && "border-foreground bg-accent",
          busy && "pointer-events-none",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-[9px] bg-primary text-primary-foreground",
            compact ? "h-10 w-10" : "h-11 w-11",
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <div className="space-y-1.5">
          <p className={cn("m-0 tracking-[-0.01em]", compact ? "text-sm" : "text-base")}>
            {busy
              ? "Reading your résumé — this can take a minute…"
              : compact
                ? "Upload a new résumé (PDF)"
                : runStatus === "completed"
                  ? filename || "Résumé parsed"
                  : "Drop your résumé, or click to upload"}
          </p>
          {!compact ? (
            <p className="m-0 text-[13px] text-faint">
              {busy ? "Extracting education, projects and skills" : runStatus === "completed" ? "Parsed · click to replace" : "PDF only, up to 6 MB"}
            </p>
          ) : null}
        </div>
        {busy && !compact ? (
          <span aria-hidden className="relative h-[3px] w-[260px] max-w-full overflow-hidden rounded-sm bg-line-2">
            <span className="absolute inset-y-0 left-0 w-2/5 animate-[iq-progress_1.2s_ease-in-out_infinite] rounded-sm bg-brand" />
          </span>
        ) : null}
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
              ? "border-line-2 bg-card text-foreground"
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
