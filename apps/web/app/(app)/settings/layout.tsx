import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { SettingsNav } from "./_components/SettingsNav";

/** Settings: one header and tab row, each section its own route. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Settings</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Your account</h1>
        <p className="m-0 mt-1.5 max-w-xl text-[14px] leading-[1.5] text-muted-foreground">
          Who you are on InterviewIQ, what we tell you about, and what happens with your data.
        </p>
      </div>
      <SettingsNav />
      <div className="mt-5">{children}</div>
    </div>
  );
}
