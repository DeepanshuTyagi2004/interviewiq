import type { Metadata } from "next";
import { ROUTES } from "@/lib/constants/shared";
import { ClosingCta } from "./_components/landing/ClosingCta";
import { LIST_DEBRIEF, LIST_INTERVIEW, LIST_RESEARCH } from "./_components/landing/content";
import { DebriefPanel } from "./_components/landing/DebriefPanel";
import { Faq } from "./_components/landing/Faq";
import { FeatureRow } from "./_components/landing/FeatureRow";
import { CompanyLogos, Hero } from "./_components/landing/Hero";
import { HowItWorks } from "./_components/landing/HowItWorks";
import { InterviewDemo } from "./_components/landing/InterviewDemo";
import { LandingMotion } from "./_components/landing/LandingMotion";
import { Personas } from "./_components/landing/Personas";
import { ReadinessTimeline } from "./_components/landing/ReadinessTimeline";
import { ResearchPanel } from "./_components/landing/ResearchPanel";
import { Universities } from "./_components/landing/Universities";

export const metadata: Metadata = {
  title: "InterviewIQ — Rehearse the interview you're actually walking into",
  description:
    "Mock interviews with an AI interviewer that knows your resume and your target company's real process. Practise round by round and get clear feedback after each one.",
};

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <CompanyLogos />
      <HowItWorks />
      <FeatureRow
        id="product"
        className="pt-24 sm:pt-[120px]"
        title="Practise the process you'll really face"
        body="We turn real candidates' interview stories into one clear, round-by-round plan for your company and role."
        items={LIST_RESEARCH}
        cta={{ label: "Browse companies free", href: ROUTES.signup }}
        panel={<ResearchPanel />}
      />
      <FeatureRow
        id="interview"
        className="pt-24 sm:pt-[120px]"
        title="A spoken interview that adapts to you"
        body="You talk, it listens. It asks about your own projects and follows your code and diagrams as you work."
        items={LIST_INTERVIEW}
        cta={{ label: "Create your free profile", href: ROUTES.signup }}
        panel={<InterviewDemo />}
        panelRight
        ink
      />
      <FeatureRow
        id="debrief"
        className="pt-24 sm:pt-[120px]"
        title="Know exactly what a strong answer looked like"
        body="After every round: what you said, what a great answer sounded like, and what to study next."
        items={LIST_DEBRIEF}
        cta={{ label: "Start free", href: ROUTES.signup }}
        panel={<DebriefPanel />}
      />
      <ReadinessTimeline />
      <Personas />
      <Universities />
      <Faq />
      <ClosingCta />
      <LandingMotion />
    </>
  );
}
