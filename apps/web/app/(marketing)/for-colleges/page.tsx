import type { Metadata } from "next";
import { ROUTES } from "@/lib/constants/shared";
import { CONTAINER, OutlineLink } from "../_components/landing/primitives";
import { Universities } from "../_components/landing/Universities";

export const metadata: Metadata = {
  title: "For colleges — InterviewIQ",
  description: "Realistic, company-specific mock interviews for every student on your placement calendar, alongside what you already run.",
};

const STEPS: [string, string][] = [
  ["Students build a profile", "A resume and, optionally, GitHub and coding-platform accounts. Nothing is fetched that the student does not connect."],
  ["They practise the companies coming to campus", "Each company's researched process, round by round, with an interviewer prepared from the student's own work."],
  ["You see readiness, not noise", "Which students have cleared which rounds of which process. Readiness is mock-interview readiness, never a certificate."],
];

export default function ForCollegesPage() {
  return (
    <>
      <section className={`${CONTAINER} flex flex-col gap-10 pt-16 sm:pt-24`}>
        <div className="flex max-w-[680px] flex-col gap-4">
          <h1 className="m-0 text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.035em]">
            Every student gets a real rehearsal before the real thing.
          </h1>
          <p className="m-0 text-[16px] leading-[1.55] text-muted-foreground">
            Placement drives are won or lost in the first round. InterviewIQ gives each student unlimited mock interviews for the
            exact companies on your calendar, and gives you a readiness view across the batch.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <OutlineLink href={ROUTES.contact} className="h-10 px-[18px]">
              Book a university pilot
            </OutlineLink>
            <OutlineLink href={ROUTES.pricing} className="h-10 px-[18px]">
              Pricing
            </OutlineLink>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex flex-col gap-2 iq-glass-card flex-col p-6">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Step {String(i + 1).padStart(2, "0")}</span>
              <h2 className="m-0 text-[20px] font-normal leading-[1.15] tracking-[-0.02em]">{title}</h2>
              <p className="m-0 text-[14.5px] leading-[1.55] text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>
      <div className="pb-16 sm:pb-24">
        <Universities />
      </div>
    </>
  );
}
