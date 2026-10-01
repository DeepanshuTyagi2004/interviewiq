"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MonoPill } from "@/components/patterns";
import { apiFetch } from "@/lib/api-client/client";
import type { SourceKind } from "@/features/profile";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

/** Maps a source to its backend authorize endpoint. Only GitHub is live. */
const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
  GITHUB: PROFILE_ENDPOINTS.githubAuthorize,
};

/** Human-readable label per source, used when no label prop is provided. */
const SOURCE_LABELS: Record<SourceKind, string> = {
  GITHUB: "GitHub",
  RESUME: "Résumé",
  LEETCODE: "LeetCode",
  LINKEDIN: "LinkedIn",
  X: "X",
};

/**
 * OAuth "Connect" for a source row. Sources without an authorize endpoint get a plain
 * "coming soon" pill instead of a button, so nothing looks clickable that isn't.
 */
export function ConnectionButton({
  source,
  label,
}: {
  source: SourceKind;
  label?: string;
}) {
  const path = AUTHORIZE_PATH[source];
  const resolvedLabel = label ?? SOURCE_LABELS[source];
  const [pending, setPending] = useState(false);

  async function connect() {
    if (!path) return;
    setPending(true);
    try {
      // apiFetch sends the in-memory Bearer token (and silently refreshes on 401).
      // A plain top-level navigation can't carry that token, so we fetch the GitHub
      // authorize URL here, then navigate the browser to it.
      const { url } = await apiFetch<{ url: string }>(path);
      window.location.href = url;
    } catch {
      setPending(false);
      toast.error(`Could not start the ${resolvedLabel} connection. Please try again.`);
    }
  }

  if (!path) {
    return (
      <MonoPill tone="ghost" className="border border-line-3">
        Coming soon
      </MonoPill>
    );
  }

  return (
    <Button
      variant="ink"
      size="sm"
      className="min-w-[96px]"
      onClick={connect}
      disabled={pending}
      aria-label={pending ? `Connecting ${resolvedLabel}…` : `Connect ${resolvedLabel}`}
    >
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}
