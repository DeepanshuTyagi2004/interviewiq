"use client";

import { Button } from "@/components/ui/button";
import { APP_CONFIG } from "@/lib/constants/config";
import type { SourceKind } from "@/features/profile";
import { SourceIcon } from "./SourceIcon";

/** Maps a source to its backend authorize endpoint. Only GitHub is live. */
const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
  GITHUB: "/api/v1/connections/github/authorize",
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

  function connect() {
    if (!path) return;
    window.location.href = `${APP_CONFIG.apiUrl}${path}`;
  }

  if (!path) {
    return (
      <Button variant="secondary" disabled>
        Coming soon
      </Button>
    );
  }

  return (
    <Button onClick={connect} aria-label={`Connect ${resolvedLabel}`}>
      <SourceIcon source={source} className="mr-2 h-4 w-4" />
      Connect {resolvedLabel}
    </Button>
  );
}
