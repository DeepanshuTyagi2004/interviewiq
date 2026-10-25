import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";

/** Shown instead of an interview action (book, reschedule, retake, join) when the account has no interview access. */
export const INTERVIEW_ACCESS_TEXT = "Mock interviews are invite-only during the beta";

export function InterviewAccessNote({ className = "" }: { className?: string }) {
  return (
    <p className={`m-0 text-[12.5px] leading-[1.5] text-ink-3 ${className}`}>
      {INTERVIEW_ACCESS_TEXT}.{" "}
      <Link href={ROUTES.contact} className="underline underline-offset-2 hover:text-foreground">
        Request access
      </Link>
    </p>
  );
}
