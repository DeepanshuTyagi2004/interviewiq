"use client";

import { useProfile, type SourceKind } from "@/features/profile";
import { EmptyState } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { PROVIDERS } from "./providers";
import { SourceList } from "./SourceList";

/**
 * Every connectable source as a stack of rows (onboarding's Sources step and the Connections
 * page). `className` is merged onto the list, e.g. to narrow it for onboarding.
 */
export function ConnectionsGrid({
  errorSource,
  exclude,
  className,
  resumeLinkedInUrl,
}: {
  errorSource?: SourceKind;
  /** Sources to leave out, e.g. the resume on onboarding (it has its own step). */
  exclude?: SourceKind[];
  /** Merged onto the list container, e.g. for narrower containers like onboarding. */
  className?: string;
  /** Current onboarding resume URL, including a draft that has not saved yet. */
  resumeLinkedInUrl?: string | null;
}) {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading your sources">
        {PROVIDERS.map((p) => (
          <Skeleton key={p.source} className="h-[70px] w-full rounded-[16px]" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="m-0 text-sm text-destructive">
        Could not load your connections. Please refresh the page.
      </p>
    );
  }

  if (PROVIDERS.length === 0) {
    return (
      <EmptyState
        title="No sources available yet"
        hint="Connectable sources will appear here."
      />
    );
  }

  const sources = exclude?.length ? PROVIDERS.map((p) => p.source).filter((s) => !exclude.includes(s)) : undefined;
  return <SourceList profile={data} sources={sources} errorSource={errorSource} className={className} resumeLinkedInUrl={resumeLinkedInUrl} />;
}
