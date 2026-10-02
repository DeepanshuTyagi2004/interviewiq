"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { LiveIngestionPanel } from "./_components/LiveIngestionPanel";
import { CompaniesPanel } from "./_components/CompaniesPanel";
import { AccessControlPanel } from "./_components/AccessControlPanel";
import { QuestionBankPanel } from "./_components/QuestionBankPanel";
import { ResumeBenchPanel } from "./_components/ResumeBenchPanel";
import { InterviewPrepBenchPanel } from "./_components/InterviewPrepBenchPanel";
import { AgentDiagnosticsPanel } from "./_components/AgentDiagnosticsPanel";

const TABS = [
  { value: "ingestion", label: "Live ingestion", Panel: LiveIngestionPanel },
  { value: "companies", label: "Companies & JDs", Panel: CompaniesPanel },
  { value: "access", label: "Access", Panel: AccessControlPanel },
  { value: "questions", label: "Question bank", Panel: QuestionBankPanel },
  { value: "resume", label: "Resume bench", Panel: ResumeBenchPanel },
  { value: "prep", label: "Interview prep", Panel: InterviewPrepBenchPanel },
  { value: "agent", label: "Agent diagnostics", Panel: AgentDiagnosticsPanel },
] as const;

export default function IntelligencePage() {
  return (
    <RequireAdmin>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Admin</p>
          <h1 className="m-0 mt-2.5 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
            Interview Intelligence
          </h1>
          <p className="m-0 mt-2 max-w-2xl text-[15px] leading-[1.5] text-muted-foreground">
            Trigger and monitor the interview-experience ingestion pipeline, test the resume, prep and
            agent pipelines, and manage who has admin access.
          </p>
        </div>

        <Tabs defaultValue="ingestion" className="mt-7">
          {/* Only the tab bar is pinned, so navigation stays in reach while the content scrolls
              normally. On phones the tabs scroll sideways instead of wrapping. */}
          <div className="sticky top-0 z-20 -mx-4 bg-card px-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
            <TabsList
              aria-label="Intelligence sections"
              className="-mx-4 flex h-auto w-auto justify-start gap-6 overflow-x-auto rounded-none bg-transparent p-0 px-4 text-faint shadow-[inset_0_-1px_0_hsl(var(--line-2))] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
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
            <TabsContent key={value} value={value} className="mt-6 rounded-[10px] focus-visible:ring-1 focus-visible:ring-offset-4">
              <Panel />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </RequireAdmin>
  );
}
