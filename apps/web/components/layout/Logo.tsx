import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * The InterviewIQ mark: a lowercase "i" in glass on a midnight-indigo squircle. The dot is the
 * interviewer's orb, lit from the top left; the stem is frosted glass. Gradient ids are fixed so
 * every instance on a page shares one definition. `app/icon.svg` carries the same drawing.
 */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 64 64" width={size} height={size} className={cn("flex-none", className)}>
      <defs>
        <linearGradient id="iqm-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2C5C" />
          <stop offset="1" stopColor="#0C0C1C" />
        </linearGradient>
        <linearGradient id="iqm-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="iqm-orb" cx=".32" cy=".26" r=".85">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".22" stopColor="#C9D2FF" />
          <stop offset=".6" stopColor="#6F7BFF" />
          <stop offset="1" stopColor="#4B2DD6" />
        </radialGradient>
        <linearGradient id="iqm-stem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".96" />
          <stop offset="1" stopColor="#C9CCEB" stopOpacity=".78" />
        </linearGradient>
        <radialGradient id="iqm-glow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#7C86FF" stopOpacity=".55" />
          <stop offset="1" stopColor="#7C86FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#iqm-tile)" />
      <rect x=".5" y=".5" width="63" height="63" rx="15.5" fill="none" stroke="url(#iqm-edge)" />
      <circle cx="32" cy="18.5" r="17" fill="url(#iqm-glow)" />
      <rect x="26" y="31" width="12" height="22" rx="6" fill="url(#iqm-stem)" />
      <circle cx="32" cy="18.5" r="8.5" fill="url(#iqm-orb)" />
      <ellipse cx="29.2" cy="15.2" rx="3" ry="2" fill="#fff" fillOpacity=".7" transform="rotate(-30 29.2 15.2)" />
    </svg>
  );
}

/** The wordmark: "Interview" in ink, "IQ" in the brand gradient. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[18px] font-semibold tracking-[-0.035em]", className)}>
      Interview<span className="iq-wordmark-iq">IQ</span>
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
      className={cn("flex flex-none items-center gap-2.5 text-foreground", className)}
    >
      <LogoMark />
      {wordmark ? <Wordmark className={wordmarkClassName} /> : null}
    </Link>
  );
}
