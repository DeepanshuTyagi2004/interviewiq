import { ExperienceForm } from "./_components/ExperienceForm";
import { ExperienceGuide } from "./_components/ExperienceGuide";

export default function ShareExperiencePage() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10">
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Share experience</p>
        <h1 className="m-0 mt-2.5 text-balance text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
          Share an interview experience
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-[15px] leading-[1.5] text-muted-foreground">
          Just interviewed somewhere? Share what happened — it helps build company-specific interview intelligence
          for everyone.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ExperienceForm />
        <ExperienceGuide />
      </div>
    </div>
  );
}
