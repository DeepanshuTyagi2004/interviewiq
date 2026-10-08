"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useDeleteAccount, usePreferences, useRenameUser, useRevokeAllSessions, useUpdatePreferences, type Preferences } from "@/features/account";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HudCard } from "@/components/hud";
import { requestPasswordReset } from "@/lib/auth/client";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { PrefRow } from "./PrefRow";

const INPUT = "h-10 rounded-full border-line-4 bg-card px-4 text-[13.5px]";
const SELECT = "h-10 w-full rounded-full border border-line-4 bg-card px-4 text-[13.5px] text-foreground hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const LANGUAGES: { value: Preferences["interview"]["language"]; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hinglish", label: "Hinglish" },
  { value: "hi", label: "Hindi" },
];
const VOICES: { value: Preferences["interview"]["voice"]; label: string }[] = [
  { value: "warm", label: "Warm" },
  { value: "neutral", label: "Neutral" },
  { value: "crisp", label: "Crisp" },
];
const PACES: { value: Preferences["interview"]["pace"]; label: string }[] = [
  { value: "slower", label: "Slower" },
  { value: "normal", label: "Normal" },
  { value: "faster", label: "Faster" },
];
const REMINDERS: { value: Preferences["interview"]["reminderLead"]; label: string }[] = [
  { value: "15m", label: "15 minutes before" },
  { value: "1h", label: "1 hour before" },
  { value: "1d", label: "A day before" },
];

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** Settings → Account: name, how you sign in, deleting the account, and interview preferences, in three columns on wide screens. */
export function AccountSettings() {
  const { user } = useCurrentUser();
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const rename = useRenameUser();
  const revoke = useRevokeAllSessions();
  const remove = useDeleteAccount();
  const router = useRouter();

  // null until edited: the field shows the account's name without copying it into state in an effect.
  const [draftName, setDraftName] = useState<string | null>(null);
  const name = draftName ?? user?.name ?? "";
  const [resetSent, setResetSent] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The confirmation fields stay hidden until the user starts deleting, so a destructive form never sits open.
  const [deleting, setDeleting] = useState(false);

  const interview = prefs.data?.interview;
  const patch = (change: Partial<Preferences["interview"]>) =>
    update.mutate({ interview: change }, { onError: (err) => toast.error(errorText(err, "Could not save that setting.")) });

  async function sendReset() {
    if (!user) return;
    try {
      await requestPasswordReset(user.email);
      setResetSent(true);
    } catch (err) {
      toast.error(errorText(err, "Could not send the reset link."));
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
      <HudCard bodyClassName="p-4 sm:p-5" title="Profile">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const next = name.trim();
            if (!next || next === user?.name) return;
            rename.mutate(next, {
              onSuccess: () => {
                setDraftName(null);
                toast.success("Name saved.");
              },
              onError: (err) => toast.error(errorText(err, "Could not save your name.")),
            });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-name">Display name</Label>
            <Input id="account-name" value={name} onChange={(e) => setDraftName(e.target.value)} maxLength={120} className={INPUT} />
            <p className="m-0 text-[12.5px] text-muted-foreground">How your interviewer and your college see you.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" value={user?.email ?? ""} readOnly className={`${INPUT} text-muted-foreground`} />
            <p className="m-0 text-[12.5px] text-muted-foreground">
              {user?.emailVerified ? "Verified." : "Not verified yet: check your inbox for the link."} Your engineering level and resume live on your{" "}
              <Link href={ROUTES.profile} className="underline underline-offset-4 hover:text-foreground">
                profile
              </Link>
              .
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={rename.isPending || !name.trim() || name.trim() === user?.name}>
              Save name
            </Button>
          </div>
        </form>
      </HudCard>

      {/* One column of Sign-in + Delete on wide screens; below that the wrapper dissolves so Delete can sit last. */}
      <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-3">
      <HudCard bodyClassName="p-4 sm:p-5" title="Sign-in">
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[14px] leading-[1.5]">
            {user?.hasPassword ? "You sign in with your email and a password." : "You sign in with Google. There is no password on this account."}
          </p>
          {user?.hasPassword ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-[12.5px] text-muted-foreground">
                {resetSent ? `A reset link is on its way to ${user.email}.` : "To change it, we email you a reset link."}
              </p>
              <Button type="button" variant="outline" disabled={resetSent} onClick={sendReset}>
                Send reset link
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="m-0 text-[12.5px] text-muted-foreground">Signed in somewhere you don&apos;t recognise? This signs out every device, including this one.</p>
            <Button
              type="button"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(undefined, {
                  onSuccess: () => router.push(ROUTES.login),
                  onError: (err) => toast.error(errorText(err, "Could not sign out everywhere.")),
                })
              }
            >
              Sign out everywhere
            </Button>
          </div>
        </div>
      </HudCard>

      <HudCard bodyClassName="p-4 sm:p-5" title="Delete account" tone="sunken" className="order-last xl:order-none">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13.5px] leading-[1.5]">
            Removes your profile, connected sources, tracks and interviews for good. Want a copy first?{" "}
            <Link href={ROUTES.settings.privacy} className="underline underline-offset-4 hover:text-foreground">
              Export your data
            </Link>
            .
          </p>
          {deleting ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="delete-email">Type your email to confirm</Label>
                  <Input id="delete-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user?.email} autoComplete="off" autoFocus className={INPUT} />
                </div>
                {user?.hasPassword ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="delete-password">Your password</Label>
                    <Input id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={INPUT} />
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDeleting(false);
                    setConfirmEmail("");
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={remove.isPending || confirmEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase() || (user?.hasPassword ? !password : false)}
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete my account
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button type="button" variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
                Delete account…
              </Button>
            </div>
          )}
        </div>
      </HudCard>
      </div>

      <HudCard bodyClassName="p-4 sm:p-5" title="Interview preferences" meta={<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Applies in the room</span>}>
        {interview ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Interview language</Label>
                <CustomSelect label="Interview language" className={SELECT} value={interview.language} options={LANGUAGES} onValueChange={(v) => patch({ language: v as Preferences["interview"]["language"] })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Interviewer voice</Label>
                <CustomSelect label="Interviewer voice" className={SELECT} value={interview.voice} options={VOICES} onValueChange={(v) => patch({ voice: v as Preferences["interview"]["voice"] })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Speaking pace</Label>
                <CustomSelect label="Speaking pace" className={SELECT} value={interview.pace} options={PACES} onValueChange={(v) => patch({ pace: v as Preferences["interview"]["pace"] })} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Reminder</Label>
                <CustomSelect label="Reminder" className={SELECT} value={interview.reminderLead} options={REMINDERS} onValueChange={(v) => patch({ reminderLead: v as Preferences["interview"]["reminderLead"] })} />
              </div>
            </div>
            <div>
              <PrefRow label="Captions" hint="Show what the interviewer says as text while they speak." checked={interview.captions} disabled={update.isPending} onChange={(captions) => patch({ captions })} />
              <PrefRow label="Round timer" hint="Show how much of the round is left." checked={interview.showTimer} disabled={update.isPending} onChange={(showTimer) => patch({ showTimer })} />
              <PrefRow label="Device check before each round" hint="Test your microphone and camera before joining." checked={interview.deviceCheck} disabled={update.isPending} onChange={(deviceCheck) => patch({ deviceCheck })} />
            </div>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">{prefs.isError ? "Your preferences are unavailable right now." : "Loading…"}</p>
        )}
      </HudCard>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account?"
        description="Everything InterviewIQ holds about you is removed right away. There is no recovery."
        confirmLabel="Delete everything"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(
            { confirmEmail: confirmEmail.trim(), ...(user?.hasPassword ? { password } : {}) },
            {
              onSuccess: () => {
                setDeleteOpen(false);
                router.push(ROUTES.home);
              },
              onError: (err) => {
                setDeleteOpen(false);
                toast.error(errorText(err, "Could not delete the account."));
              },
            },
          )
        }
      />
    </div>
  );
}
