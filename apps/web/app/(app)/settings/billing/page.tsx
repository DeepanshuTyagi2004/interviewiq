import Link from "next/link";
import { HudCard, HudEmpty } from "@/components/hud";
import { ROUTES } from "@/lib/constants/shared";

/** Settings → Billing & plan: nothing is charged yet; the page says so instead of showing an empty invoice list. */
export default function SettingsBillingPage() {
  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <HudCard title="Plan">
        <HudEmpty tag="No plan yet" title="Nothing to pay for right now" hint="Plans are being finalised. Everything you can do today stays available, and this page shows your plan and invoices once billing exists." />
      </HudCard>
      <HudCard title="Colleges">
        <p className="m-0 text-[14px] leading-[1.5]">
          Practising through your college? Your placement cell holds the licence; there is nothing for you to pay.
        </p>
        <p className="m-0 mt-2 text-[12.5px] text-muted-foreground">
          Running a placement cell?{" "}
          <Link href={ROUTES.forColleges} className="underline underline-offset-4 hover:text-foreground">
            See InterviewIQ for colleges
          </Link>
          .
        </p>
      </HudCard>
    </div>
  );
}
