"use client";

import Link from "next/link";
import { useProfile } from "@/features/profile";
import { ROUTES } from "@/lib/constants/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PageHeader,
  StatRow,
  StatTile,
  DashboardSkeleton,
} from "@/components/patterns";

export default function DashboardPage() {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="flex-1 p-6">
        <p role="alert" className="text-sm text-destructive">
          Could not load your dashboard. Please refresh the page.
        </p>
      </div>
    );
  }

  const firstName = data.user.name?.split(" ")[0] ?? "there";
  const totalSources = data.sources.length;
  const connectedCount = data.sources.filter((s) => s.connected).length;
  const githubConnected = data.sources.some(
    (s) => s.source === "GITHUB" && s.connected,
  );

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Your interview prep starts with a complete profile."
        actions={
          <Button asChild>
            <Link href={ROUTES.connections}>Connect a source</Link>
          </Button>
        }
      />

      <StatRow>
        <StatTile value={connectedCount} label="Sources connected" />
        <StatTile value={totalSources} label="Sources available" />
        <StatTile value={data.mostUsedSkills.length} label="Skills detected" />
        <StatTile value={data.notable.length} label="Notable items" />
      </StatRow>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
          <CardDescription>
            Connect your accounts so your profile reflects your real work.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          {!githubConnected ? (
            <Button asChild variant="outline">
              <Link href={ROUTES.connections}>Connect GitHub</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={ROUTES.profile}>View your profile</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
