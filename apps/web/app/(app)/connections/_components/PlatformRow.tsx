"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, MonoPill, type MonoPillTone } from "@/components/patterns";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  useProfile,
  useConnectPlatform,
  useDisconnectPlatform,
  type CodingPlatformFragment,
  type CodingPlatformKind,
  type SourceKind,
  type SyncStatus,
} from "@/features/profile";
import { PROFILE_POLLING, PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { joinDetail, sourceDate } from "./format";
import { SourceRow, type SourceRowVariant } from "./SourceRow";
import { sourceDotState } from "./sourceDotState";
import type { ProviderMeta } from "./providers";

const CODING_PLATFORMS: readonly CodingPlatformKind[] = ["CODEFORCES", "CODECHEF", "ATCODER", "TUF"];

export function isCodingPlatform(source: SourceKind): source is CodingPlatformKind {
  return (CODING_PLATFORMS as readonly string[]).includes(source);
}

/** Per-platform form copy: what a handle looks like and where to find it. */
const FORM: Record<CodingPlatformKind, { field: string; placeholder: string; hint: string }> = {
  CODEFORCES: { field: "Codeforces handle", placeholder: "e.g. tourist or codeforces.com/profile/tourist", hint: "Your handle from your Codeforces profile URL." },
  CODECHEF: { field: "CodeChef username", placeholder: "e.g. aakash_42", hint: "From codechef.com/users/your-username." },
  ATCODER: { field: "AtCoder username", placeholder: "e.g. aakash42", hint: "From atcoder.jp/users/your-username." },
  TUF: {
    field: "takeUforward username",
    placeholder: "e.g. Kirito1965 or takeuforward.org/profile/Kirito1965",
    hint: "From takeuforward.org/profile/your-username. LeetCode, Codeforces and other profiles you linked on TUF connect automatically.",
  },
};

function messageForCode(code: string | undefined, label: string): string {
  switch (code) {
    case "platform_user_not_found":
      return `That ${label} profile doesn’t exist. Check the spelling and try again.`;
    case "platform_handle_invalid":
    case "platform_bad_request":
      return `That doesn’t look like a ${label} username or profile link.`;
    case "platform_unreachable":
      return `Couldn’t reach ${label} right now. Please try again in a moment.`;
    default:
      return `Couldn’t connect ${label}. Please try again.`;
  }
}

const SYNC_PILL: Record<SyncStatus, { label: string; tone: MonoPillTone }> = {
  [PROFILE_SYNC_STATUS.syncing]: { label: "Syncing", tone: "soft" },
  [PROFILE_SYNC_STATUS.synced]: { label: "Synced", tone: "soft" },
  [PROFILE_SYNC_STATUS.failed]: { label: "Sync failed", tone: "alert" },
  [PROFILE_SYNC_STATUS.degraded]: { label: "Limited data", tone: "ghost" },
};

/** One fact for the connected row's detail line: the platform's own rating, else problems solved. */
function fragmentDetail(fragment: CodingPlatformFragment | undefined): string | null {
  if (!fragment) return null;
  const rating = fragment.info?.rating ?? fragment.rating ?? null;
  if (rating) return `rating ${rating.toLocaleString()}`;
  return fragment.totalSolved ? `${fragment.totalSolved.toLocaleString()} solved` : null;
}

/**
 * A coding platform connected by handle: "Connect" opens an inline handle form; the connect call
 * validates the handle and starts a background import, and the row polls the shared profile query
 * while the import is SYNCING. Same lifecycle as the LeetCode row.
 */
export function PlatformRow({
  platform,
  provider,
  variant = "stack",
}: {
  platform: CodingPlatformKind;
  provider: ProviderMeta;
  variant?: SourceRowVariant;
}) {
  const { data } = useProfile();
  const source = data?.sources.find((s) => s.source === platform);
  const connected = Boolean(source?.connected);
  const status = source?.status === "IMPORTED" ? undefined : source?.status;
  useProfile({ refetchInterval: status === PROFILE_SYNC_STATUS.syncing ? PROFILE_POLLING.syncIntervalMs : false });

  const fragment = data?.fragments[platform.toLowerCase() as Lowercase<CodingPlatformKind>];
  const connect = useConnectPlatform(platform);
  const disconnect = useDisconnectPlatform(platform);
  const form = FORM[platform];

  const [formOpen, setFormOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [lastSubmitted, setLastSubmitted] = useState<string | undefined>();
  const formId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(`Please enter your ${form.field}.`);
      return;
    }
    setError(undefined);
    setLastSubmitted(trimmed);
    connect.mutate(trimmed, {
      onError: (err) => setError(messageForCode(err instanceof ApiFetchError ? err.code : undefined, provider.label)),
    });
  }

  function handleDisconnect() {
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success(`${provider.label} disconnected`),
      onError: () => toast.error(`Could not disconnect ${provider.label}. Please try again.`),
    });
  }

  const displayName = fragment?.handle ?? lastSubmitted;
  const synced = status === PROFILE_SYNC_STATUS.synced ? sourceDate(source?.lastRefreshedAt) : null;
  const state = sourceDotState({
    connected,
    syncing: connected && status === PROFILE_SYNC_STATUS.syncing,
    error: connected && status === PROFILE_SYNC_STATUS.failed,
  });
  const stateLabel = connected && (status === PROFILE_SYNC_STATUS.syncing || status === PROFILE_SYNC_STATUS.failed) ? null : undefined;
  const pill = connected && status ? (
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
        state={state}
        stateLabel={stateLabel}
        pill={pill}
        detail={joinDetail([displayName ? `@${displayName}` : "Connected", fragmentDetail(fragment), synced ? `synced ${synced}` : null])}
        actions={
          <>
            {status === PROFILE_SYNC_STATUS.failed && displayName ? (
              <Button variant="ink" size="sm" disabled={connect.isPending} onClick={() => submit(displayName)}>
                {connect.isPending ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
            <Button variant="strong" size="sm" className="min-w-[96px]" onClick={handleDisconnect} disabled={disconnect.isPending}>
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        }
      >
        {status === PROFILE_SYNC_STATUS.syncing ? (
          <p role="status" className="m-0 text-[13px] text-muted-foreground">
            Importing your {provider.label} data… this can take a few seconds.
          </p>
        ) : status === PROFILE_SYNC_STATUS.degraded ? (
          <p className="m-0 text-[13px] text-muted-foreground">
            We’re showing your last imported data. {provider.label} didn’t find this profile on the latest refresh.
          </p>
        ) : status === PROFILE_SYNC_STATUS.failed ? (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            The last import failed. Retry, or disconnect and reconnect.
          </p>
        ) : null}
      </SourceRow>
    );
  }

  const showForm = formOpen || connect.isPending || Boolean(error);

  return (
    <SourceRow
      variant={variant}
      code={provider.code}
      name={provider.label}
      state={state}
      stateLabel={stateLabel}
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
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-expanded={false}
            aria-controls={formId}
            aria-label={`Connect ${provider.label}`}
          >
            Connect
          </Button>
        )
      }
    >
      {/* Not a <form>: rows also render inside onboarding's step form, and forms can't nest. */}
      <div role="group" aria-label={`Connect ${provider.label}`} className="flex flex-col gap-3">
        <FormField label={form.field} htmlFor={inputId} hint={form.hint} error={error}>
          <Input
            id={inputId}
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (error) setError(undefined);
            }}
            placeholder={form.placeholder}
            autoComplete="off"
            spellCheck={false}
            ref={inputRef}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!connect.isPending && handle.trim().length > 0) submit(handle);
              }
            }}
            aria-invalid={error ? true : undefined}
            disabled={connect.isPending}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ink" size="sm" onClick={() => submit(handle)} disabled={connect.isPending || handle.trim().length === 0}>
            {connect.isPending ? "Connecting…" : `Connect ${provider.label}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={connect.isPending}
            onClick={() => {
              setFormOpen(false);
              setError(undefined);
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
