import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";
import { CONTAINER, OutlineLink } from "../_components/landing/primitives";

export const metadata: Metadata = {
  title: "Pricing — InterviewIQ",
  description: "Students can sign up and practise today while plans are finalised. Colleges run InterviewIQ as a pilot.",
};

const WHO = [
  {
    eyebrow: "STUDENTS AND PROFESSIONALS",
    title: "Sign up and start practising",
    body: "Create a profile from your resume, pick a company and role, and see its real interview process, round by round. Mock interviews are opening to accounts in stages during the beta.",
    cta: { label: "Start for free", href: ROUTES.signup },
  },
  {
    eyebrow: "COLLEGES AND PLACEMENT CELLS",
    title: "Run a pilot with your placement office",
    body: "Students practise the companies coming to your campus; the placement cell sees readiness across the batch. Pilots are scoped and priced with you.",
    cta: { label: "Book a demo", href: ROUTES.contact },
  },
];

/** No price list yet: plans are a product decision still open, so this page routes each audience without promising numbers. */
export default function PricingPage() {
  return (
    <section className={`${CONTAINER} flex flex-col gap-10 py-16 sm:py-24`}>
      <div className="flex max-w-[640px] flex-col gap-4">
        <h1 className="m-0 text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.035em]">Free while we&apos;re in beta.</h1>
        <p className="m-0 text-[16px] leading-[1.55] text-muted-foreground">
          Nothing is paywalled. Students and professionals sign up free; colleges get a pilot scoped with them. When paid plans
          arrive, they&apos;ll be on this page first.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {WHO.map((w) => (
          <div key={w.eyebrow} className="flex flex-col gap-4 iq-glass-card p-6 sm:p-8">
            <h2 className="m-0 text-[24px] font-semibold leading-[1.1] tracking-[-0.03em]">{w.title}</h2>
            <p className="m-0 -mt-2 text-sm text-ink-3">{w.eyebrow}</p>
            <p className="m-0 text-[15px] leading-[1.55] text-muted-foreground">{w.body}</p>
            <OutlineLink href={w.cta.href} className="mt-auto h-10 w-fit px-[18px]">
              {w.cta.label}
            </OutlineLink>
          </div>
        ))}
      </div>
      <p className="m-0 text-[14px] text-muted-foreground">
        Questions about a pilot or a bulk licence?{" "}
        <Link href={ROUTES.contact} className="underline underline-offset-4 hover:text-foreground">
          Get in touch
        </Link>
        .
      </p>
    </section>
  );
}
