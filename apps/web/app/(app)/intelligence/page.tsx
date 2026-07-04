"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/patterns";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { LiveIngestionPanel } from "./_components/LiveIngestionPanel";
import { CompaniesPanel } from "./_components/CompaniesPanel";
import { AccessControlPanel } from "./_components/AccessControlPanel";
import { QuestionBankPanel } from "./_components/QuestionBankPanel";
import { ResumeBenchPanel } from "./_components/ResumeBenchPanel";
import { InterviewPrepBenchPanel } from "./_components/InterviewPrepBenchPanel";

export default function IntelligencePage() {
  return (
    <RequireAdmin>
      {/* Natural page scroll. Only the title + tabs band is pinned, so the navigation
          stays visible while the content scrolls normally. */}
      <div className="p-6">
        <Tabs defaultValue="ingestion">
          <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 space-y-4 border-b border-border bg-background/80 px-6 pb-4 pt-6 backdrop-blur">
            <PageHeader
              title="Interview Intelligence"
              description="Trigger and monitor the interview-experience ingestion pipeline, and manage who has admin access."
            />
            <TabsList>
              <TabsTrigger value="ingestion">Live ingestion</TabsTrigger>
              <TabsTrigger value="companies">Companies &amp; JDs</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
              <TabsTrigger value="questions">Question bank</TabsTrigger>
              <TabsTrigger value="resume">Résumé bench</TabsTrigger>
              <TabsTrigger value="prep">Interview prep</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="ingestion" className="mt-0">
            <LiveIngestionPanel />
          </TabsContent>

          <TabsContent value="companies" className="mt-0">
            <CompaniesPanel />
          </TabsContent>

          <TabsContent value="access" className="mt-0">
            <AccessControlPanel />
          </TabsContent>

          <TabsContent value="questions" className="mt-0">
            <QuestionBankPanel />
          </TabsContent>

          <TabsContent value="resume" className="mt-0">
            <ResumeBenchPanel />
          </TabsContent>

          <TabsContent value="prep" className="mt-0">
            <InterviewPrepBenchPanel />
          </TabsContent>
        </Tabs>
      </div>
    </RequireAdmin>
  );
}
