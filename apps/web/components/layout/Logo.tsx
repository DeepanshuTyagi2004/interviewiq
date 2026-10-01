import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** The three-bar mark: tall, medium, and a faded short bar. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-[15px] items-end gap-[2px]", className)}>
      <span className="h-[15px] w-1 bg-foreground" />
      <span className="h-[10px] w-1 bg-foreground" />
      <span className="h-[5px] w-1 bg-brand" />
    </span>
  );
}

/** Mark + wordmark, linking home (or wherever `href` points). */
export function Logo({
  href = "/",
  className,
  wordmark = true,
}: {
  href?: string;
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="InterviewIQ home"
      className={cn("flex flex-none items-center gap-[9px] text-foreground", className)}
    >
      <LogoMark />
      {wordmark ? (
        <span className="text-[17px] font-medium tracking-[-0.035em]">interviewIQ</span>
      ) : null}
    </Link>
  );
}
