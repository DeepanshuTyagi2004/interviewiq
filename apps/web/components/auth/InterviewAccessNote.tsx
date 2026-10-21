/** Shown instead of an interview action (book, reschedule, retake, join) when the account has no interview access. */
export const INTERVIEW_ACCESS_TEXT = "Ask an admin for interview access";

export function InterviewAccessNote({ className = "" }: { className?: string }) {
  return <p className={`m-0 text-[12.5px] leading-[1.5] text-ink-3 ${className}`}>{INTERVIEW_ACCESS_TEXT}</p>;
}
