import { PageHeader } from "@/components/ds";
import { ExperienceForm } from "./_components/ExperienceForm";
import { ExperienceGuide } from "./_components/ExperienceGuide";

export default function ShareExperiencePage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Share experience"
        title="Share an interview experience"
        description="Just interviewed somewhere? Share what happened — it helps build company-specific interview intelligence for everyone."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ExperienceForm />
        <ExperienceGuide />
      </div>
    </div>
  );
}
