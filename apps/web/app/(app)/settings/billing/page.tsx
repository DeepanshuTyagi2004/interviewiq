import Link from "next/link";
import { Card, EmptyState } from "@/components/ds";
import { ROUTES } from "@/lib/constants/shared";

/** Settings → Billing & plan: nothing is charged yet; the page says so instead of showing an empty invoice list. */
export default function SettingsBillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card title="Plan">
        <EmptyState
          title="Nothing to pay for right now"
          hint="Plans are being finalised. Everything you can do today stays available, and this page shows your plan and invoices once billing exists."
        />
      </Card>
      <Card title="Colleges">
        <p className="m-0 text-[14px] leading-[1.5]">
          Practising through your college? Your placement cell holds the licence; there is nothing for you to pay.
        </p>
        <p className="m-0 mt-2 text-[13px] text-ink-3">
          Running a placement cell?{" "}
          <Link href={ROUTES.forColleges} className="text-ink-2 underline underline-offset-4 hover:text-foreground">
            See InterviewIQ for colleges
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
