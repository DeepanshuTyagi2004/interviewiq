"use client";

import type { ProfileResponse, SourceKind } from "@/features/profile";
import { cn } from "@/lib/utils/cn";
import { joinDetail } from "./format";
import { LeetCodeRow } from "./LeetCodeRow";
import { isCodingPlatform, PlatformRow } from "./PlatformRow";
import { ProviderRow } from "./ProviderRow";
import { PROVIDERS } from "./providers";
import { ResumeRow } from "./ResumeRow";
import { LinkedInRow } from "./LinkedInRow";
import type { SourceRowVariant } from "./SourceRow";

/** What the GitHub fragment already tells us, for the row's detail line. */
function githubSummary(profile: ProfileResponse): string | undefined {
  const gh = profile.fragments.github;
  if (!gh) return undefined;
  return joinDetail([
    gh.login ? `@${gh.login}` : null,
    `${gh.publicRepos.toLocaleString()} public ${gh.publicRepos === 1 ? "repo" : "repos"}`,
  ]);
}

export interface SourceListProps {
  profile: ProfileResponse;
  variant?: SourceRowVariant;
  /** Limit (and order) the sources shown; defaults to every provider. */
  sources?: SourceKind[];
  errorSource?: SourceKind;
  className?: string;
  resumeLinkedInUrl?: string | null;
}

/**
 * The rows for each connectable source. LeetCode has a username + async-sync flow of its own and
 * the resume is an upload-and-parse import. LinkedIn retrieves a consented public URL snapshot
 * for explicit section review; the other providers use the generic OAuth-style row. Source rows
 * distinguish imported snapshots from live collection.
 */
export function SourceList({ profile, variant = "stack", sources, errorSource, className, resumeLinkedInUrl }: SourceListProps) {
  const byKind = Object.fromEntries(profile.sources.map((s) => [s.source, s]));
  const providers = sources
    ? sources.flatMap((kind) => PROVIDERS.filter((p) => p.source === kind))
    : PROVIDERS;

  return (
    <ul className={cn("m-0 list-none p-0", variant === "stack" && "grid gap-2", className)}>
      {providers.map((provider) => {
        if (provider.source === "LEETCODE") {
          return (
            <LeetCodeRow
              key={provider.source}
              provider={provider}
              variant={variant}
              errored={errorSource === provider.source}
            />
          );
        }
        if (isCodingPlatform(provider.source)) {
          return <PlatformRow key={provider.source} platform={provider.source} provider={provider} variant={variant} />;
        }
        if (provider.source === "RESUME") {
          return <ResumeRow key={provider.source} provider={provider} variant={variant} />;
        }
        if (provider.source === "LINKEDIN") {
          return <LinkedInRow key={provider.source} provider={provider} variant={variant} resumeLinkedInUrl={resumeLinkedInUrl} />;
        }
        const src = byKind[provider.source];
        return (
          <ProviderRow
            key={provider.source}
            provider={provider}
            variant={variant}
            connected={Boolean(src?.connected)}
            lastRefreshedAt={src?.lastRefreshedAt}
            summary={provider.source === "GITHUB" ? githubSummary(profile) : undefined}
            errored={errorSource === provider.source}
          />
        );
      })}
    </ul>
  );
}
