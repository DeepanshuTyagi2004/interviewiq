import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "../_components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms — InterviewIQ",
  description: "The rules for using InterviewIQ's mock interviews.",
};

// DRAFT for the owner's legal review.
const SECTIONS: LegalSection[] = [
  {
    title: "What InterviewIQ is",
    body: [
      "InterviewIQ is practice: AI-run mock interviews modelled on companies' publicly reported interview processes.",
      "Scores, readiness levels and reports describe how you did in mock interviews on InterviewIQ. They are not a certification, a job offer, or an endorsement by any company.",
    ],
  },
  {
    title: "Your account",
    body: [
      "Give accurate details and keep your password to yourself. You're responsible for what happens in your account.",
      "Only upload resumes, profiles and documents that are yours.",
    ],
  },
  {
    title: "Fair use",
    body: [
      "Take rounds yourself, without outside help. Rounds run full-screen, and leaving full-screen or switching tabs pauses them.",
      "Don't try to break, overload or copy the service, or misuse other people's data.",
    ],
  },
  {
    title: "Beta",
    body: [
      "InterviewIQ is in beta. Features, access and plans may change, and some may be unavailable at times.",
      "It's free while in beta. If paid plans arrive, we'll show them on the pricing page before anything is charged.",
    ],
  },
  {
    title: "Ending your account",
    body: ["You can delete your account at any time from Settings. We may suspend accounts that break these terms."],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      intro="The short version: practise honestly, use your own data, and treat your results as practice, not a credential."
      updated="25 October 2026"
      sections={SECTIONS}
    />
  );
}
