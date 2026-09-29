"use client";

import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import {
  formToRequest,
  responseToForm,
  useCandidateProfile,
  useSaveCandidateProfile,
} from "@/features/onboarding";
import { ResumeUpload } from "@/features/onboarding/components/ResumeUpload";
import { ConnectionStatus } from "./ConnectionStatus";
import { SourceIcon } from "./SourceIcon";
import type { ProviderMeta } from "./providers";

/**
 * Résumé "connection": upload a PDF → parse it (async fire-and-poll, so a slow model can't time
 * out) → save the result to the candidate profile. Unlike GitHub/LeetCode this isn't an OAuth/paste
 * link — it's a one-shot import that populates the profile, which the user can then edit on Profile.
 */
export function ResumeCard({ provider }: { provider: ProviderMeta }) {
  const { data: profile } = useCandidateProfile();
  const save = useSaveCandidateProfile();

  const hasProfile = Boolean(
    profile &&
      (profile.resumeFilename ||
        profile.experience.length ||
        profile.education.length ||
        profile.projects.length ||
        profile.skills.length),
  );

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SourceIcon source="RESUME" className="h-5 w-5" />
            <CardTitle className="text-base">{provider.label}</CardTitle>
          </div>
          <ConnectionStatus state={hasProfile ? "connected" : "not-connected"} />
        </div>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        {profile?.resumeFilename ? (
          <p className="text-xs text-muted-foreground">
            Last parsed: <span className="font-medium">{profile.resumeFilename}</span>
          </p>
        ) : null}
        <ResumeUpload
          compact
          successMessage="Résumé saved to your profile — review or edit it on your Profile page."
          onParsed={(draft) => {
            save.mutate(formToRequest(responseToForm(draft), false), {
              onSuccess: () => toast.success("Résumé saved to your profile."),
              onError: () => toast.error("Couldn’t save your résumé. Please try again."),
            });
          }}
        />
        {hasProfile ? (
          <Button asChild variant="ghost" size="sm" className="self-start px-0">
            <Link href={ROUTES.profile}>Review on your profile →</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
