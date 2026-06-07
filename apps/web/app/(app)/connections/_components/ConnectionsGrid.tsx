"use client";

import { Link2 } from "lucide-react";
import { ProviderCard } from "./ProviderCard";
import { PROVIDERS } from "./providers";
import { useProfile, type SourceKind } from "@/features/profile";
import { ConnectionsSkeleton, EmptyState } from "@/components/patterns";

export function ConnectionsGrid({ errorSource }: { errorSource?: SourceKind }) {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <ConnectionsSkeleton />;
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-destructive">
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

  const byKind = Object.fromEntries(data.sources.map((s) => [s.source, s]));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PROVIDERS.map((provider) => {
        const src = byKind[provider.source];
        return (
          <ProviderCard
            key={provider.source}
            provider={provider}
            connected={Boolean(src?.connected)}
            lastRefreshedAt={src?.lastRefreshedAt}
            errored={errorSource === provider.source}
          />
        );
      })}
    </div>
  );
}
