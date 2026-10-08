"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { getValidationControls, patchValidationControl } from "@/features/admin-validation-controls/api";
import type {
  ValidationControlKey,
  ValidationControlSettings,
  ValidationControlsResponse,
} from "@/features/admin-validation-controls/types";

const QUERY_KEY = ["admin", "validation-controls"];

const CONTROL_DEFINITIONS: Array<{
  key: ValidationControlKey;
  title: string;
  description: string;
  warning?: string;
}> = [
  {
    key: "linkedinImportEnabled",
    title: "LinkedIn import enabled",
    description: "Allow candidates to upload their LinkedIn Save to PDF file for review and import.",
    warning: "Disabling this stops all new LinkedIn PDF imports before any extraction runs.",
  },
  {
    key: "requireSectionReview",
    title: "Section review required",
    description: "Keep section selection and source publication behind an explicit review step.",
  },
];

const CONFIRMATION_KEYS = new Set<ValidationControlKey>(["linkedinImportEnabled"]);

type ConfirmationState = {
  key: ValidationControlKey;
  nextValue: false;
} | null;

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function actorLabel(user: ReturnType<typeof useCurrentUser>["user"]) {
  return user?.name || user?.email || "Current admin";
}

export function ValidationControlsPanel() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const query = useQuery<ValidationControlsResponse>({
    queryKey: QUERY_KEY,
    queryFn: getValidationControls,
  });
  const [draftSettings, setDraftSettings] = useState<ValidationControlSettings | null>(null);
  const [lastUpdatedBy, setLastUpdatedBy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [savingKey, setSavingKey] = useState<ValidationControlKey | null>(null);
  const [inlineStatus, setInlineStatus] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const settings = draftSettings ?? query.data?.settings ?? null;
  const updatedBy = lastUpdatedBy ?? query.data?.updatedBy ?? null;

  const definitionsByKey = useMemo(
    () => new Map(CONTROL_DEFINITIONS.map((definition) => [definition.key, definition])),
    [],
  );

  async function saveChange(key: ValidationControlKey, nextValue: boolean, previousValue: boolean) {
    setSavingKey(key);
    setInlineError(null);
    setInlineStatus(null);
    setDraftSettings((current) => (current ? { ...current, [key]: nextValue } : current));

    try {
      const response = await patchValidationControl(key, nextValue);
      setDraftSettings(response.settings);
      setLastUpdatedBy(response.updatedBy ?? actorLabel(user));
      queryClient.setQueryData(QUERY_KEY, response);
      setInlineStatus(`${definitionsByKey.get(key)?.title ?? "Validation control"} saved.`);
      toast.success("Validation control saved.");
    } catch (error) {
      setDraftSettings((current) => (current ? { ...current, [key]: previousValue } : current));
      const message = error instanceof Error ? error.message : "Could not save validation control.";
      setInlineError(message);
      toast.error("Could not save validation control.");
      throw error;
    } finally {
      setSavingKey(null);
    }
  }

  function requestChange(key: ValidationControlKey, nextValue: boolean) {
    if (!settings || savingKey) return;
    const previousValue = settings[key];
    if (previousValue === nextValue) return;

    if (!nextValue && CONFIRMATION_KEYS.has(key)) {
      setConfirmation({ key, nextValue: false });
      return;
    }

    setDraftSettings({ ...settings, [key]: nextValue });
    void saveChange(key, nextValue, previousValue).catch(() => undefined);
  }

  const confirmationDefinition = confirmation ? definitionsByKey.get(confirmation.key) : undefined;
  const isLoading = query.isLoading || !settings;

  return (
    <main id="validation-controls" className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-10 lg:py-14">
          <header className="mb-8 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              <span>Admin only</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em]">Validation controls</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Admin-only defaults for LinkedIn PDF import. Changes apply to new operations and are persisted by the API.
                </p>
              </div>
              <nav aria-label="Admin settings sections" className="text-sm">
                <Link className="underline underline-offset-4" href="/admin/settings#validation-controls">
                  Validation Controls
                </Link>
              </nav>
            </div>
          </header>

          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading validation controls">
              {CONTROL_DEFINITIONS.map((definition) => (
                <div key={definition.key} className="h-28 animate-pulse rounded-[14px] border bg-card" />
              ))}
            </div>
          ) : query.isError || !settings ? (
            <Card role="alert" className="border-destructive/40">
              <CardHeader>
                <CardTitle>Could not load validation controls</CardTitle>
                <CardDescription>Admin settings are unavailable right now. Retry to read the persisted state.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <section aria-labelledby="controls-heading" className="space-y-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="controls-heading" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Backend defaults
                  </h2>
                  <span className="text-xs text-muted-foreground">Persisted state</span>
                </div>
                <div className="grid gap-3">
                  {CONTROL_DEFINITIONS.map((definition) => {
                    const checked = settings[definition.key];
                    const saving = savingKey === definition.key;
                    const reviewControl = definition.key === "requireSectionReview";
                    return (
                      <Card key={definition.key} className="border-line-2 shadow-none">
                        <CardContent className="flex items-start justify-between gap-5 p-5 sm:p-6">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <label htmlFor={`validation-control-${definition.key}`} className="font-medium">
                                {definition.title}
                              </label>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${checked ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                                {checked ? "On" : "Off"}
                              </span>
                            </div>
                            <p className="m-0 max-w-3xl text-sm leading-6 text-muted-foreground">{definition.description}</p>
                            {definition.warning ? (
                              <p className="m-0 flex max-w-3xl items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span>{definition.warning}</span>
                              </p>
                            ) : null}
                            {reviewControl ? (
                              <p className="m-0 text-xs leading-5 text-muted-foreground">
                                Turning this flag off does not auto-confirm or publish a draft. Section selection and review validation remain explicit and required.
                              </p>
                            ) : null}
                          </div>
                          <Switch
                            id={`validation-control-${definition.key}`}
                            aria-label={definition.title}
                            checked={checked}
                            disabled={Boolean(savingKey)}
                            onCheckedChange={(nextValue) => requestChange(definition.key, nextValue)}
                          />
                        </CardContent>
                        {saving ? <p role="status" className="px-5 pb-4 text-xs text-muted-foreground sm:px-6">Saving…</p> : null}
                      </Card>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="audit-heading" className="mt-8 rounded-[14px] border border-line-2 bg-panel/50 p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <h2 id="audit-heading" className="text-sm font-medium">Persistence and audit</h2>
                </div>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Updated at</dt>
                    <dd className="mt-1 font-mono text-xs">{formatTimestamp(query.data?.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Updated by</dt>
                    <dd className="mt-1 text-xs">
                      {updatedBy ?? "Not returned by the current API response"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  The API is the source of truth for the values above. The current response exposes the timestamp but not the persisted audit actor.
                </p>
              </section>

              {inlineStatus ? <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{inlineStatus}</p> : null}
              {inlineError ? <p role="alert" className="mt-4 text-sm text-destructive">{inlineError}</p> : null}
            </>
          )}
        </div>

      {confirmation && confirmationDefinition ? (
        <ConfirmationDialog
          open
          onOpenChange={(open) => { if (!open && !savingKey) setConfirmation(null); }}
          title={`Disable ${confirmationDefinition.title.toLowerCase()}?`}
          description={confirmationDefinition.warning ?? "This changes a backend validation default for future operations."}
          confirmLabel="Disable control"
          destructive
          pending={savingKey === confirmation.key}
          onConfirm={() => {
            if (!settings) return Promise.resolve();
            const previousValue = settings[confirmation.key];
            return saveChange(confirmation.key, confirmation.nextValue, previousValue);
          }}
        />
      ) : null}
    </main>
  );
}
