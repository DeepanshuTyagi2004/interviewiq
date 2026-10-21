import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** The one InterviewIQ mark: an ink rounded square with three page-coloured bars (tall, medium, short). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-[22px] w-[22px] flex-none items-end justify-center gap-[2px] rounded-[7px] bg-foreground px-[5px] pb-[5px]", className)}>
      <span className="h-3 w-[3px] rounded-[1px] bg-background" />
      <span className="h-2 w-[3px] rounded-[1px] bg-background" />
      <span className="h-[5px] w-[3px] rounded-[1px] bg-background" />
    </span>
  );
}

/** Mark + wordmark, linking home (or wherever `href` points). */
export function Logo({
  href = "/",
  className,
  wordmark = true,
  wordmarkClassName,
}: {
  href?: string;
  className?: string;
  wordmark?: boolean;
  /** e.g. hide the wordmark on narrow screens and keep just the mark. */
  wordmarkClassName?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="InterviewIQ home"
      className={cn("flex flex-none items-center gap-[9px] text-foreground", className)}
    >
      <LogoMark />
      {wordmark ? (
        <span className={cn("text-[17px] font-medium tracking-[-0.035em]", wordmarkClassName)}>interviewIQ</span>
      ) : null}
    </Link>
  );
}
