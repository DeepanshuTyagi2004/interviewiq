"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, MonoPill, type MonoPillTone } from "@/components/patterns";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  useProfile,
  useConnectLeetCode,
  useDisconnectLeetCode,
  type SyncStatus,
} from "@/features/profile";
import { PROFILE_POLLING, PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { joinDetail, sourceDate } from "./format";
import { SourceRow, type SourceRowVariant } from "./SourceRow";
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

const SYNC_PILL: Record<SyncStatus, { label: string; tone: MonoPillTone }> = {
  [PROFILE_SYNC_STATUS.syncing]: { label: "Syncing", tone: "soft" },
  [PROFILE_SYNC_STATUS.synced]: { label: "Synced", tone: "soft" },
  [PROFILE_SYNC_STATUS.failed]: { label: "Sync failed", tone: "alert" },
  [PROFILE_SYNC_STATUS.degraded]: { label: "Limited data", tone: "ghost" },
};

/**
 * LeetCode by username: "Connect" opens an inline username form; the connect call validates the
 * handle and starts a background import, and the row polls the shared profile query while the
 * import is SYNCING so it flips to SYNCED / FAILED on its own.
 */
export function LeetCodeRow({
  provider,
  errored,
  variant = "stack",
}: {
  provider: ProviderMeta;
  errored?: boolean;
  variant?: SourceRowVariant;
}) {
  // Read status from the shared profile query; poll only while a sync is in flight.
  const source = useSourceStatus();
  const connected = Boolean(source?.connected);
  const status = source?.status;

  // Polls the shared profile query every 5s while syncing so the row flips to SYNCED/FAILED.
  useProfile({ refetchInterval: status === PROFILE_SYNC_STATUS.syncing ? PROFILE_POLLING.syncIntervalMs : false });

  const profileQuery = useProfile();
  const fragment = profileQuery.data?.fragments.leetcode;
  const leetcodeUsername = fragment?.username;

  const connect = useConnectLeetCode();
  const disconnect = useDisconnectLeetCode();

  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | undefined>();
  // Remember the handle just submitted so a failed sync can be retried without re-typing.
  const [lastSubmitted, setLastSubmitted] = useState<string | undefined>();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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

  const displayName = leetcodeUsername ?? lastSubmitted;
  const solved = fragment?.solved ? (fragment.solved.total ?? fragment.solved.easy + fragment.solved.medium + fragment.solved.hard) : null;
  const synced = status === PROFILE_SYNC_STATUS.synced ? sourceDate(source?.lastRefreshedAt) : null;

  const pill = errored ? (
    <MonoPill tone="alert">Error</MonoPill>
  ) : connected && status ? (
    <MonoPill tone={SYNC_PILL[status].tone}>
      {status === PROFILE_SYNC_STATUS.syncing ? (
        <span aria-hidden data-motion className="mr-1.5 h-1.5 w-1.5 animate-[iq-breathe_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
      ) : null}
      {SYNC_PILL[status].label}
    </MonoPill>
  ) : null;

  if (connected) {
    return (
      <SourceRow
        variant={variant}
        code={provider.code}
        name={provider.label}
        connected
        pill={pill}
        detail={joinDetail([
          displayName ? `@${displayName}` : "Connected",
          solved !== null ? `${solved.toLocaleString()} solved` : null,
          synced ? `synced ${synced}` : null,
        ])}
        actions={
          <>
            {status === PROFILE_SYNC_STATUS.failed && (displayName ?? lastSubmitted) ? (
              <Button
                variant="ink"
                size="sm"
                disabled={connect.isPending}
                onClick={() => submit(displayName ?? lastSubmitted!)}
              >
                {connect.isPending ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
            <Button
              variant="strong"
              size="sm"
              className="min-w-[96px]"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        }
      >
        {status === PROFILE_SYNC_STATUS.syncing ? (
          <p role="status" className="m-0 text-[13px] text-muted-foreground">
            Importing your LeetCode data… this can take a few seconds.
          </p>
        ) : status === PROFILE_SYNC_STATUS.degraded ? (
          <p className="m-0 text-[13px] text-muted-foreground">
            We’re showing your last imported data — LeetCode didn’t return a public profile on the latest refresh.
          </p>
        ) : status === PROFILE_SYNC_STATUS.failed ? (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            The last import failed. Retry, or disconnect and reconnect.
          </p>
        ) : null}
      </SourceRow>
    );
  }

  // Keep the form open while a connect is in flight or has an error to show.
  const showForm = formOpen || connect.isPending || Boolean(error);

  return (
    <SourceRow
      variant={variant}
      code={provider.code}
      name={provider.label}
      pill={pill}
      detail={provider.description}
      bodyId={formId}
      bodyHidden={!showForm}
      actions={
        showForm ? null : (
          <Button
            type="button"
            variant="ink"
            size="sm"
            className="min-w-[96px]"
            ref={toggleRef}
            onClick={() => {
              setFormOpen(true);
              // After React commits the open form, move focus into it.
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-expanded={false}
            aria-controls={formId}
            aria-label="Connect LeetCode"
          >
            Connect
          </Button>
        )
      }
    >
      {/* Not a <form>: this row also renders inside onboarding's step form, and forms can't nest.
          Enter in the field submits, like a form would. */}
      <div role="group" aria-label="Connect LeetCode" className="flex flex-col gap-3">
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
            ref={inputRef}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!connect.isPending && username.trim().length > 0) submit(username);
              }
            }}
            aria-invalid={error ? true : undefined}
            disabled={connect.isPending}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={() => submit(username)}
            disabled={connect.isPending || username.trim().length === 0}
          >
            {connect.isPending ? "Connecting…" : "Connect LeetCode"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={connect.isPending}
            onClick={() => {
              setFormOpen(false);
              setError(undefined);
              // Hand focus back to the row's Connect button once it's rendered again.
              requestAnimationFrame(() => toggleRef.current?.focus());
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </SourceRow>
  );
}

/** Pull the LeetCode source row out of the shared profile query. */
function useSourceStatus() {
  const { data } = useProfile();
  return data?.sources.find((s) => s.source === "LEETCODE");
}
