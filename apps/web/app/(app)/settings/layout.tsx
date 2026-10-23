import { PageHeader } from "@/components/ds";
import { SettingsNav } from "./_components/SettingsNav";

/** Settings: a left sub-nav (a pill segment below 1024px), each section its own route. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Your account"
        description="Who you are on InterviewIQ, what we tell you about, and what happens with your data."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 max-w-[820px]">{children}</div>
      </div>
    </div>
  );
}
