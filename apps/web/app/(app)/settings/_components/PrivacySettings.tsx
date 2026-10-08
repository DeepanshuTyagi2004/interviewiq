"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useExportAccount, usePreferences, useUpdatePreferences, type Preferences } from "@/features/account";
import { Button } from "@/components/ui/button";
import { HudCard } from "@/components/hud";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { PrefRow } from "./PrefRow";

const VISIBILITY: { value: Preferences["privacy"]["leaderboardVisibility"]; label: string; hint: string }[] = [
  { value: "name", label: "With my name", hint: "Peers at your level see your name and score." },
  { value: "anonymous", label: "Anonymously", hint: "You appear as a rank without a name." },
  { value: "hidden", label: "Hidden", hint: "You are left out of the leaderboard entirely." },
];

/** Settings → Privacy & data: who sees what, and getting your data out. */
export function PrivacySettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const exportAll = useExportAccount();
  const p = prefs.data?.privacy;
  const save = (patch: Partial<Preferences["privacy"]>) =>
    update.mutate({ privacy: patch }, { onError: (err) => toast.error(err instanceof Error && err.message ? err.message : "Could not save that setting.") });

  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <HudCard bodyClassName="p-4 sm:p-5" title="Leaderboard">
        {p ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
              The profile leaderboard is opt-in from your{" "}
              <Link href={ROUTES.profile} className="underline underline-offset-4 hover:text-foreground">
                profile
              </Link>
              . Once you are in, this is how you appear.
            </p>
            <div role="radiogroup" aria-label="Leaderboard visibility" className="flex flex-col gap-2">
              {VISIBILITY.map((v) => {
                const selected = p.leaderboardVisibility === v.value;
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={update.isPending}
                    onClick={() => save({ leaderboardVisibility: v.value })}
                    className={cn(
                      "flex items-start gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors",
                      selected ? "border-foreground bg-card" : "border-line-3 bg-panel hover:border-faint-2",
                    )}
                  >
                    <span aria-hidden className={cn("mt-1 h-3 w-3 flex-none rounded-full border", selected ? "border-foreground bg-foreground" : "border-faint-2")} />
                    <span className="min-w-0">
                      <span className="block text-[14px]">{v.label}</span>
                      <span className="block text-[12.5px] text-muted-foreground">{v.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">{prefs.isError ? "Your preferences are unavailable right now." : "Loading…"}</p>
        )}
      </HudCard>

      <HudCard bodyClassName="p-4 sm:p-5" title="Sharing">
        {p ? (
          <div>
            <PrefRow label="Share readiness with my college" hint="Your placement cell sees which rounds you have cleared. Never your answers." checked={p.shareWithCollege} disabled={update.isPending} onChange={(shareWithCollege) => save({ shareWithCollege })} />
            <PrefRow label="Let partner companies find me" hint="Companies hiring through InterviewIQ can see you are interview-ready for their process." checked={p.partnerDiscovery} disabled={update.isPending} onChange={(partnerDiscovery) => save({ partnerDiscovery })} />
            <PrefRow label="Use my interviews to improve InterviewIQ" hint="Anonymised; helps calibrate questions and feedback." checked={p.improveWithMyData} disabled={update.isPending} onChange={(improveWithMyData) => save({ improveWithMyData })} />
          </div>
        ) : null}
      </HudCard>

      <HudCard bodyClassName="p-4 sm:p-5" title="Your data" className="lg:col-span-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[14px] leading-[1.5]">Download everything InterviewIQ holds about you as one JSON file.</p>
            <p className="m-0 mt-1 text-[12.5px] text-muted-foreground">
              Profile, connected sources, tracks, interviews and settings. To remove it all instead, delete your account from the{" "}
              <Link href={ROUTES.settings.account} className="underline underline-offset-4 hover:text-foreground">
                Account
              </Link>{" "}
              tab.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={exportAll.isPending}
            onClick={() => exportAll.mutate(undefined, { onError: (err) => toast.error(err instanceof Error && err.message ? err.message : "Could not export your data.") })}
          >
            {exportAll.isPending ? "Preparing…" : "Export my data"}
          </Button>
        </div>
      </HudCard>
    </div>
  );
}
