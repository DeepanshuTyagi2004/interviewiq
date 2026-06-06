"use client";

import { ProviderCard } from "./ProviderCard";
import { PROVIDERS } from "./providers";
import { useProfile, type SourceKind } from "@/features/profile";
import { Skeleton } from "@/components/ui/skeleton";

export function ConnectionsGrid({ errorSource }: { errorSource?: SourceKind }) {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <Skeleton key={p.source} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        Could not load your connections. Please refresh the page.
      </p>
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
