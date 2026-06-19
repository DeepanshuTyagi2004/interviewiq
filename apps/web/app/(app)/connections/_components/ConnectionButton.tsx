"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client/client";
import type { SourceKind } from "@/features/profile";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";
import { SourceIcon } from "./SourceIcon";

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
      <Button variant="secondary" disabled aria-label={`${resolvedLabel} — coming soon`}>
        Coming soon
      </Button>
    );
  }

  return (
    <Button onClick={connect} disabled={pending} aria-label={`Connect ${resolvedLabel}`}>
      <SourceIcon source={source} className="mr-2 h-4 w-4" />
      {pending ? "Connecting…" : `Connect ${resolvedLabel}`}
    </Button>
  );
}
