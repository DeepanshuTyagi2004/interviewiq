"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionButton } from "./ConnectionButton";
import { DisconnectDialog } from "./DisconnectDialog";
import { ConnectionStatus, type ConnectionState } from "./ConnectionStatus";
import { SourceIcon } from "./SourceIcon";
import type { ProviderMeta } from "./providers";

/** Future refresh affordance — intentionally hidden until the endpoint ships. */
const SHOW_REFRESH = false;

export interface ProviderCardProps {
  provider: ProviderMeta;
  connected: boolean;
  lastRefreshedAt?: string;
  errored?: boolean;
}

function deriveState(p: ProviderCardProps): ConnectionState {
  if (p.errored) return "error";
  if (p.connected) return "connected";
  return "not-connected";
}

export function ProviderCard(props: ProviderCardProps) {
  const { provider, connected, lastRefreshedAt, errored } = props;
  const state = deriveState(props);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SourceIcon source={provider.source} className="h-5 w-5" />
            <CardTitle className="text-base">{provider.label}</CardTitle>
          </div>
          <ConnectionStatus state={state} />
        </div>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected && lastRefreshedAt ? (
          <p className="text-xs text-muted-foreground">
            Last refreshed {new Date(lastRefreshedAt).toLocaleDateString()}
          </p>
        ) : null}
        {errored ? (
          <p className="text-xs text-destructive">
            Connection failed. Please try connecting again.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              {SHOW_REFRESH ? (
                <button type="button" className="text-sm underline">
                  Refresh
                </button>
              ) : null}
              {provider.live ? <DisconnectDialog label={provider.label} /> : null}
            </>
          ) : (
            <ConnectionButton source={provider.source} label={provider.label} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
