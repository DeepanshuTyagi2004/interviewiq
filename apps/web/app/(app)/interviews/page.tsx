import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { parseBookingPrefill } from "@/features/interview/presentation";
import { BookingForm } from "./_components/BookingForm";
import { SessionsList } from "./_components/SessionsList";
import { PageHeader } from "@/components/ds";

/**
 * Mock interviews hub: your sessions (upcoming and past) beside the booking form. A roadmap link
 * (`?jd=<jdId>&round=<roundType>`) pre-selects the role and round; bad values are ignored.
 * Server Component shell; the form and list are client components (hooks + interaction).
 */
export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parseBookingPrefill(await searchParams);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Interviews"
        title="Mock interviews"
        description="Book a round and we prepare an interviewer from your own resume and the company's real process. Join from here when it's ready."
        actions={
          <Button asChild variant="outline">
            <Link href={ROUTES.jobs}>Browse companies</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-[76px]">
          <BookingForm
            key={`${prefill.jobDescriptionId ?? ""}:${prefill.roundType ?? ""}`}
            initialJobDescriptionId={prefill.jobDescriptionId}
            initialRoundType={prefill.roundType}
          />
        </div>
        <div className="min-w-0">
          <SessionsList />
        </div>
      </div>
    </div>
  );
}
