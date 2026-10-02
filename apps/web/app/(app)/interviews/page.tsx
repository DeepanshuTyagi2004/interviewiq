import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { parseBookingPrefill } from "@/features/interview/presentation";
import { BookingForm } from "./_components/BookingForm";
import { SessionsList } from "./_components/SessionsList";

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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Interviews</p>
          <h1 className="m-0 mt-2.5 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
            Mock interviews
          </h1>
          <p className="m-0 mt-2 max-w-[620px] text-[15px] leading-[1.5] text-muted-foreground">
            Book a round and we prepare an interviewer from your own resume and the company&apos;s real
            process. Join from here when it&apos;s ready.
          </p>
        </div>
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
          <Link href={ROUTES.jobs}>Browse companies</Link>
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <BookingForm
            key={`${prefill.jobDescriptionId ?? ""}:${prefill.roundType ?? ""}`}
            initialJobDescriptionId={prefill.jobDescriptionId}
            initialRoundType={prefill.roundType}
          />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <SessionsList />
        </div>
      </div>
    </div>
  );
}
