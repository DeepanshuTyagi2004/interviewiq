"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/patterns";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  useProfile,
  useConnectLeetCode,
  useDisconnectLeetCode,
  type SyncStatus,
} from "@/features/profile";
import { PROFILE_POLLING, PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { ConnectionStatus } from "./ConnectionStatus";
import { SourceIcon } from "./SourceIcon";
import type { ProviderMeta } from "./providers";

/** Reduce a pasted URL / @handle to a bare LeetCode username (backend normalizes too). */
function toUsername(raw: string): string {
  let v = raw.trim();
  const m = v.match(/(?:https?:\/\/)?(?:www\.)?leetcode\.com\/(?:u\/)?([^/?#\s]+)/i);
  if (m) v = m[1];
  if (v.startsWith("@")) v = v.slice(1);
  return v.trim();
}

/** Map the backend error `code` to an inline, actionable message. */
function messageForCode(code: string | undefined): string {
  switch (code) {
    case "leetcode_user_not_found":
      return "That LeetCode username doesn’t exist. Check the spelling and try again.";
    case "leetcode_profile_private":
      return "Your LeetCode profile is private. Go to LeetCode Settings → Privacy and set your profile to public, then try again.";
    case "leetcode_rate_limited":
    case "leetcode_unreachable":
      return "Couldn’t reach LeetCode right now. Please try again in a moment.";
    case "leetcode_bad_request":
      return "Please enter your LeetCode username.";
    default:
      return "Couldn’t connect LeetCode. Please try again.";
  }
}

const SYNC_BADGE: Record<SyncStatus, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  [PROFILE_SYNC_STATUS.syncing]: { label: "Syncing…", variant: "secondary" },
  [PROFILE_SYNC_STATUS.synced]: { label: "Synced", variant: "secondary" },
  [PROFILE_SYNC_STATUS.failed]: { label: "Sync failed", variant: "destructive" },
  [PROFILE_SYNC_STATUS.degraded]: { label: "Limited data", variant: "outline" },
};

export function LeetCodeCard({
  provider,
  errored,
}: {
  provider: ProviderMeta;
  errored?: boolean;
}) {
  // Read status from the shared profile query; poll only while a sync is in flight.
  const source = useSourceStatus();
  const connected = Boolean(source?.connected);
  const status = source?.status;

  // Polls the shared profile query every 5s while syncing so the card flips to SYNCED/FAILED.
  useProfile({ refetchInterval: status === PROFILE_SYNC_STATUS.syncing ? PROFILE_POLLING.syncIntervalMs : false });

  const profileQuery = useProfile();
  const leetcodeUsername = profileQuery.data?.fragments.leetcode?.username;

  const connect = useConnectLeetCode();
  const disconnect = useDisconnectLeetCode();

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | undefined>();
  // Remember the handle just submitted so a failed sync can be retried without re-typing.
  const [lastSubmitted, setLastSubmitted] = useState<string | undefined>();

  function submit(value: string) {
    const handle = toUsername(value);
    if (!handle) {
      setError("Please enter your LeetCode username.");
      return;
    }
    setError(undefined);
    setLastSubmitted(handle);
    connect.mutate(handle, {
      onError: (err) => {
        const code = err instanceof ApiFetchError ? err.code : undefined;
        setError(messageForCode(code));
      },
    });
  }

  function handleDisconnect() {
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success("LeetCode disconnected"),
      onError: () => toast.error("Could not disconnect LeetCode. Please try again."),
    });
  }

  const cardState = errored ? "error" : connected ? "connected" : "not-connected";
  const displayName = leetcodeUsername ?? lastSubmitted;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SourceIcon source={provider.source} className="h-5 w-5" />
            <CardTitle className="text-base">{provider.label}</CardTitle>
          </div>
          <ConnectionStatus state={cardState} />
        </div>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>

      <CardContent className="mt-auto space-y-3">
        {connected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {displayName ? (
                <span className="text-sm font-medium">@{displayName}</span>
              ) : (
                <span className="text-sm text-muted-foreground">Connected</span>
              )}
              {status ? (
                <Badge variant={SYNC_BADGE[status].variant}>{SYNC_BADGE[status].label}</Badge>
              ) : null}
            </div>

            {status === PROFILE_SYNC_STATUS.synced && source?.lastRefreshedAt ? (
              <p className="text-xs text-muted-foreground">
                Last synced{" "}
                <span className="font-mono tabular-nums">
                  {new Date(source.lastRefreshedAt).toLocaleDateString()}
                </span>
              </p>
            ) : null}
            {status === PROFILE_SYNC_STATUS.syncing ? (
              <p className="text-xs text-muted-foreground">
                Importing your LeetCode data… this can take a few seconds.
              </p>
            ) : null}
            {status === PROFILE_SYNC_STATUS.degraded ? (
              <p className="text-xs text-muted-foreground">
                We’re showing your last imported data — LeetCode didn’t return a public profile on the
                latest refresh.
              </p>
            ) : null}
            {status === PROFILE_SYNC_STATUS.failed ? (
              <p role="alert" className="text-xs text-destructive">
                The last import failed. Retry, or disconnect and reconnect.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {status === PROFILE_SYNC_STATUS.failed && (displayName ?? lastSubmitted) ? (
                <Button
                  variant="secondary"
                  disabled={connect.isPending}
                  onClick={() => submit(displayName ?? lastSubmitted!)}
                >
                  {connect.isPending ? "Retrying…" : "Retry"}
                </Button>
              ) : null}
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnect.isPending}>
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(username);
            }}
          >
            <FormField
              label="LeetCode username"
              htmlFor="leetcode-username"
              hint="Your LeetCode profile must be public for the import to work."
              error={error}
            >
              <Input
                id="leetcode-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(undefined);
                }}
                placeholder="e.g. aakash_42"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                disabled={connect.isPending}
              />
            </FormField>
            <Button type="submit" disabled={connect.isPending || username.trim().length === 0}>
              <SourceIcon source={provider.source} className="mr-2 h-4 w-4" />
              {connect.isPending ? "Connecting…" : "Connect LeetCode"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Pull the LeetCode source row out of the shared profile query. */
function useSourceStatus() {
  const { data } = useProfile();
  return data?.sources.find((s) => s.source === "LEETCODE");
}
