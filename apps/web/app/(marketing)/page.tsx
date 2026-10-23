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
import { WhyCards } from "./_components/landing/WhyCards";

export const metadata: Metadata = {
  title: "InterviewIQ — Rehearse the interview you're actually walking into",
  description:
    "An AI interviewer that knows your resume and your target company's real process. Practise round by round, get a debrief after every round, and track your readiness.",
};

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <CompanyLogos />
      <FeatureRow
        id="product"
        className="pt-20 sm:pt-24"
        title="Practise the process you'll really face"
        body="Turn scattered interview experiences into one clear, round-by-round process for your company and role — so every practice session counts."
        items={LIST_RESEARCH}
        cta={{ label: "Explore company research", href: ROUTES.jobs }}
        panel={<ResearchPanel />}
      />
      <FeatureRow
        id="interview"
        className="pt-24 sm:pt-[120px]"
        title="A spoken interview that adapts to you"
        body="It greets you, asks about your own projects, and takes you through the round one question at a time — reading your code and diagrams as you work."
        items={LIST_INTERVIEW}
        cta={{ label: "See a sample interview", href: ROUTES.login }}
        panel={<InterviewDemo />}
        panelRight
        ink
      />
      <FeatureRow
        id="debrief"
        className="pt-24 sm:pt-[120px]"
        title="Know exactly what a strong answer looked like"
        body="Every round ends with a question-by-question breakdown — what you said, what great sounded like, and what to study before your next attempt."
        items={LIST_DEBRIEF}
        cta={{ label: "See a sample debrief", href: ROUTES.login }}
        panel={<DebriefPanel />}
      />
      <HowItWorks />
      <ReadinessTimeline />
      <WhyCards />
      <Universities />
      <Personas />
      <ClosingCta />
      <Faq />
      <LandingMotion />
    </>
  );
}
