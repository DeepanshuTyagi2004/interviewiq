import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-5 gap-y-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-[13px] text-ink-3">{eyebrow}</div> : null}
        <h1 className="m-0 mt-1.5 font-display text-[32px] font-light leading-[1.1] tracking-[-0.035em] sm:text-[40px]">
          {title}
        </h1>
        {description ? <p className="m-0 mt-3 max-w-2xl text-[14px] leading-[1.55] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface SectionHeaderProps {
  title: React.ReactNode;
  /** Adds a chevron link after the title. */
  href?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, href, actions, className }: SectionHeaderProps) {
  const heading = (
    <h2 className="m-0 flex items-center gap-1.5 font-display text-[18px] font-medium tracking-[-0.01em]">
      {title}
      {href ? <ChevronRight aria-hidden className="h-4 w-4 text-ink-3" strokeWidth={1.8} /> : null}
    </h2>
  );
  return (
    <div className={cn("mb-3.5 flex items-center justify-between gap-3", className)}>
      {href ? (
        <Link
          href={href}
          className="rounded-md outline-none transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {heading}
        </Link>
      ) : (
        heading
      )}
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
