"use client";

import { Link2 } from "lucide-react";
import { useProfile, type SourceKind } from "@/features/profile";
import { EmptyState } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { PROVIDERS } from "./providers";
import { SourceList } from "./SourceList";

/**
 * Every connectable source as a stack of rows (onboarding's Sources step and the Connections
 * page). `className` is merged onto the list, e.g. to narrow it for onboarding.
 */
export function ConnectionsGrid({
  errorSource,
  className,
}: {
  errorSource?: SourceKind;
  /** Merged onto the list container, e.g. for narrower containers like onboarding. */
  className?: string;
}) {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return (
      <div className="grid gap-2.5" aria-busy="true" aria-label="Loading your sources">
        {PROVIDERS.map((p) => (
          <Skeleton key={p.source} className="h-[70px] w-full rounded-lg" />
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
        icon={<Link2 />}
        title="No sources available yet"
        hint="Connectable sources will appear here."
      />
    );
  }

  return <SourceList profile={data} errorSource={errorSource} className={className} />;
}
