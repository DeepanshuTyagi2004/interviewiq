"use client";

import { Suspense, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { deepLinkHref, parseDeepLink, type IntelligenceTab } from "@/features/research";
import { LiveIngestionPanel } from "./_components/LiveIngestionPanel";
import { AccessControlPanel } from "./_components/AccessControlPanel";
import { QuestionBankPanel } from "./_components/QuestionBankPanel";
import { ResumeBenchPanel } from "./_components/ResumeBenchPanel";
import { InterviewPrepBenchPanel } from "./_components/InterviewPrepBenchPanel";
import { AgentDiagnosticsPanel } from "./_components/AgentDiagnosticsPanel";
import { CompaniesTab } from "./_components/research/CompaniesTab";
import { RunsTab } from "./_components/research/RunsTab";

const TABS: ReadonlyArray<{ value: IntelligenceTab; label: string; Panel: () => ReactNode }> = [
  { value: "companies", label: "Companies", Panel: CompaniesTab },
  { value: "runs", label: "Runs", Panel: RunsTab },
  { value: "briefs", label: "Briefs (legacy)", Panel: LiveIngestionPanel },
  { value: "access", label: "Access", Panel: AccessControlPanel },
  { value: "questions", label: "Question bank", Panel: QuestionBankPanel },
  { value: "resume", label: "Resume bench", Panel: ResumeBenchPanel },
  { value: "prep", label: "Interview prep", Panel: InterviewPrepBenchPanel },
  { value: "agent", label: "Agent diagnostics", Panel: AgentDiagnosticsPanel },
];

export default function IntelligencePage() {
  return (
    <RequireAdmin>
      {/* The tabs read ?tab=&run=&span= via useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <IntelligenceTabs />
      </Suspense>
    </RequireAdmin>
  );
}

function IntelligenceTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { tab } = parseDeepLink(params);
  const onTab = (value: string) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: value as IntelligenceTab }), { scroll: false });

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Admin</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Interview Intelligence</h1>
        <p className="m-0 mt-1.5 max-w-2xl text-[14px] leading-[1.5] text-muted-foreground">
          Curate the companies we research, run and debug the research pipeline step by step, test the resume, prep and
          agent pipelines, and manage who has admin access.
        </p>
      </div>

      <Tabs value={tab} onValueChange={onTab} className="mt-5">
        <div className="sticky top-0 z-20 -mx-4 bg-card px-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          <TabsList
            aria-label="Intelligence sections"
            className="-mx-4 flex h-auto w-auto justify-start gap-6 overflow-x-auto rounded-none bg-transparent p-0 px-4 text-faint shadow-[inset_0_-1px_0_hsl(var(--line-2))] sm:mx-0 sm:px-0"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="shrink-0 rounded-none border-b-[1.5px] border-transparent px-0 pb-3 pt-3.5 text-sm font-normal text-faint transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {TABS.map(({ value, Panel }) => (
          <TabsContent key={value} value={value} className="mt-6 rounded-[14px] focus-visible:ring-1 focus-visible:ring-offset-4">
            <Panel />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
