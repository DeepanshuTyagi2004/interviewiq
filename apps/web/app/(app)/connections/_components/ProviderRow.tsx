"use client";

import { MonoPill } from "@/components/patterns";
import { ConnectionButton } from "./ConnectionButton";
import { DisconnectDialog } from "./DisconnectDialog";
import { joinDetail, sourceDate } from "./format";
import { SourceRow, type SourceRowVariant } from "./SourceRow";
import { sourceDotState } from "./sourceDotState";
import type { ProviderMeta } from "./providers";

export interface ProviderRowProps {
  provider: ProviderMeta;
  connected: boolean;
  lastRefreshedAt?: string;
  /** What we already know from this source, e.g. "@asha · 18 public repos". */
  summary?: string;
  errored?: boolean;
  variant?: SourceRowVariant;
}

/** An OAuth-style source (GitHub today; LinkedIn and X later): connect, or disconnect with a confirm. */
export function ProviderRow({
  provider,
  connected,
  lastRefreshedAt,
  summary,
  errored,
  variant = "stack",
}: ProviderRowProps) {
  const refreshed = sourceDate(lastRefreshedAt);
  const detail = connected
    ? joinDetail([summary ?? "Connected", refreshed ? `refreshed ${refreshed}` : null])
    : provider.description;

  return (
    <SourceRow
      variant={variant}
      code={provider.code}
      name={provider.label}
      detail={detail}
      connected={connected}
      state={sourceDotState({ connected, syncing: false, error: Boolean(errored) })}
      // `errored` here is a failed OAuth connect, not a failed sync.
      stateLabel={errored ? "Connection failed" : undefined}
      unavailable={!provider.live}
      pill={errored ? <MonoPill tone="alert">Error</MonoPill> : null}
      actions={
        connected ? (
          provider.live ? (
            <DisconnectDialog label={provider.label} />
          ) : null
        ) : (
          <ConnectionButton source={provider.source} label={provider.label} />
        )
      }
    >
      {errored ? (
        <p role="alert" className="m-0 text-[13px] text-destructive">
          Connection failed. Please try connecting again.
        </p>
      ) : null}
    </SourceRow>
  );
}
