import { ExperienceForm } from "./_components/ExperienceForm";
import { ExperienceGuide } from "./_components/ExperienceGuide";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

export default function ShareExperiencePage() {
  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Share experience</p>
        <h1 className="m-0 mt-1.5 text-balance text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          Share an interview experience
        </h1>
        <p className="m-0 mt-1.5 max-w-2xl text-[14px] leading-[1.5] text-muted-foreground">
          Just interviewed somewhere? Share what happened — it helps build company-specific interview intelligence
          for everyone.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ExperienceForm />
        <ExperienceGuide />
      </div>
    </div>
  );
}
