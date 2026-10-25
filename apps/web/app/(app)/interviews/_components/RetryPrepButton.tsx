"use client";

import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { INTERVIEW_ACCESS_TEXT, InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import { ApiFetchError } from "@/lib/api-client/client";
import { useRetryPrep, type InterviewSession } from "@/features/interview";

/** Retry a failed prep. The server limits retries per hour; its 429 message says when to try again. */
export function RetryPrepButton({
  session,
  label = "Retry prep",
  size,
  variant,
  className,
}: {
  session: InterviewSession;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
}) {
  const retry = useRetryPrep();
  const { canInterview, interviewBlocked } = useCurrentUser();
  if (interviewBlocked) return <InterviewAccessNote className={className} />;
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={retry.isPending || !canInterview}
      onClick={() =>
        retry.mutate(session.id, {
          onSuccess: () => toast.success("Preparing your interview again…"),
          onError: (err) =>
            toast.error(
              err instanceof ApiFetchError && err.code === "interview_access_required"
                ? INTERVIEW_ACCESS_TEXT
                : err instanceof ApiFetchError && err.status === 429
                  ? err.message
                  : "Couldn't retry prep. Please try again.",
            ),
        })
      }
    >
      <RotateCw aria-hidden data-motion className={cn(retry.isPending && "animate-spin")} />
      {label}
    </Button>
  );
}
