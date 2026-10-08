"use client";

import { toast } from "sonner";
import { usePreferences, useUpdatePreferences, type NotificationTopic } from "@/features/account";
import { Switch } from "@/components/ui/switch";
import { HudCard } from "@/components/hud";
import { PrefRow } from "./PrefRow";

const TOPICS: { key: NotificationTopic; label: string; hint: string }[] = [
  { key: "interviewReminders", label: "Interview reminders", hint: "Before each booked round, at the lead time set on your account." },
  { key: "debriefReady", label: "Debrief ready", hint: "When a finished round's debrief is in." },
  { key: "retakeAvailable", label: "Retake available", hint: "When a cooldown ends and a round can be taken again." },
  { key: "targetOpenings", label: "Target openings", hint: "When a company you follow posts a role." },
  { key: "weeklyDigest", label: "Weekly digest", hint: "Your week: rounds taken, readiness, what to book next." },
  { key: "productUpdates", label: "Product updates", hint: "New companies, new round types, new features." },
];

/** Settings → Notifications: what we tell you about, by channel. */
export function NotificationSettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const n = prefs.data?.notifications;
  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, { onError: (err) => toast.error(err instanceof Error && err.message ? err.message : "Could not save that setting.") });

  if (!n) {
    return (
      <HudCard bodyClassName="p-4 sm:p-5" title="Notifications">
        <p className="m-0 text-[13px] text-muted-foreground">{prefs.isError ? "Your preferences are unavailable right now." : "Loading…"}</p>
      </HudCard>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <HudCard
        bodyClassName="px-4 pb-1 pt-3 sm:px-5"
        title="What we tell you about"
        meta={
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
            {n.emailPaused ? "Email paused" : "Email on"}
          </span>
        }
      >
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_64px_64px] items-end gap-3 border-b border-line pb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          <span>Topic</span>
          <span className="text-center">Email</span>
          <span className="text-center">In app</span>
        </div>
        {TOPICS.map((t) => (
          <div key={t.key} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0">
              <p className="m-0 text-[14px]">{t.label}</p>
              <p className="m-0 mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">{t.hint}</p>
            </div>
            <div className="flex justify-center">
              <Switch aria-label={`${t.label} by email`} checked={n.email[t.key]} disabled={update.isPending || n.emailPaused} onCheckedChange={(v) => save({ notifications: { email: { [t.key]: v } } })} />
            </div>
            <div className="flex justify-center">
              <Switch aria-label={`${t.label} in the app`} checked={n.inApp[t.key]} disabled={update.isPending} onCheckedChange={(v) => save({ notifications: { inApp: { [t.key]: v } } })} />
            </div>
          </div>
        ))}
      </HudCard>

      <div className="flex flex-col gap-3 lg:sticky lg:top-6">
        <HudCard bodyClassName="p-4 sm:p-5" title="Email">
          <PrefRow label="Pause all email" hint="Keep your choices, send nothing for now." checked={n.emailPaused} disabled={update.isPending} onChange={(emailPaused) => save({ notifications: { emailPaused } })} />
          <p className="m-0 mt-3 text-[12.5px] leading-[1.5] text-muted-foreground">
            Email delivery is being set up. Your choices are saved now and take effect the moment it goes live; in-app notices appear in the bell at the top of every page.
          </p>
        </HudCard>
      </div>
    </div>
  );
}
