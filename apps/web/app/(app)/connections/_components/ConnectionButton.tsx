"use client";

import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_CONFIG } from "@/lib/constants/config";
import type { SourceKind } from "@/features/profile";

/** Maps a source to its backend authorize endpoint. Only GitHub is live. */
const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
  GITHUB: "/api/v1/connections/github/authorize",
};

export function ConnectionButton({ source }: { source: SourceKind }) {
  const path = AUTHORIZE_PATH[source];

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
    <Button onClick={connect} aria-label={`Connect ${source.toLowerCase()}`}>
      <GitBranch className="mr-2 h-4 w-4" aria-hidden />
      Connect GitHub
    </Button>
  );
}
