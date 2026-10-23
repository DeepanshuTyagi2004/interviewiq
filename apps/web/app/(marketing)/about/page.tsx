import type { Metadata } from "next";
import { ROUTES } from "@/lib/constants/shared";
import { CONTAINER, OutlineLink } from "../_components/landing/primitives";

export const metadata: Metadata = {
  title: "About — InterviewIQ",
  description: "Why InterviewIQ exists: realistic, company-specific mock interviews for every engineer, not just the well-connected.",
};

const PRINCIPLES: [string, string][] = [
  ["The real process, not a generic one", "Every company page is researched from candidates' own accounts of their interviews, round by round, and says how much data is behind it."],
  ["An interviewer who read your resume", "The AI interviewer prepares from your resume, projects and coding profiles, and runs the round the way that company would."],
  ["Evidence on every claim", "Every line in your profile summary and every score in a debrief points back to what it was based on. You can always ask why."],
  ["Readiness, not badges", "Clearing a company's unedited process makes you interview-ready for that role on InterviewIQ. It is practice, never an endorsement from the company."],
];

export default function AboutPage() {
  return (
    <section className={`${CONTAINER} flex flex-col gap-12 py-16 sm:py-24`}>
      <div className="flex max-w-[680px] flex-col gap-4">
        <h1 className="m-0 text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.035em]">
          Interview practice is scarce, expensive and inconsistent. It shouldn&apos;t be.
        </h1>
        <p className="m-0 text-[16px] leading-[1.55] text-muted-foreground">
          Most engineers walk into their first real interviews without ever having rehearsed one. Peer mock interviews are hard to
          find and uneven; problem sets don&apos;t talk back. InterviewIQ gives every candidate unlimited, company-specific, spoken
          mock interviews with an interviewer who knows their background, starting with students in India preparing for campus
          placements, and working engineers preparing for a switch.
        </p>
      </div>
      <dl className="m-0 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {PRINCIPLES.map(([title, body]) => (
          <div key={title} className="flex flex-col gap-2 border-t border-line-3 pt-5">
            <dt className="text-[18px] font-medium tracking-[-0.02em]">{title}</dt>
            <dd className="m-0 text-[15px] leading-[1.55] text-muted-foreground">{body}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-3">
        <OutlineLink href={ROUTES.signup} className="h-10 px-[18px]">
          Start for free
        </OutlineLink>
        <OutlineLink href={ROUTES.forColleges} className="h-10 px-[18px]">
          For colleges
        </OutlineLink>
      </div>
    </section>
  );
}
