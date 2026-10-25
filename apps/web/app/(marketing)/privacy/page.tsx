import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "../_components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — InterviewIQ",
  description: "What InterviewIQ collects, why, and how to export or delete it.",
};

// DRAFT for the owner's legal review: describes what the product does today in plain words.
const SECTIONS: LegalSection[] = [
  {
    title: "What we collect",
    body: [
      "Your account: name, email and, if you use one, a password (stored only as a secure hash).",
      "Your profile: the resume you upload and the details you add or edit, such as education, experience, projects and skills. We don't use the photo on a resume.",
      "Sources you choose to connect: public data from GitHub, LeetCode and other coding platforms, and the LinkedIn PDF you upload. Nothing is fetched from a source you haven't connected.",
      "Your interviews: the bookings you make, what is said and written during a mock round, and the report that follows.",
    ],
  },
  {
    title: "Why we use it",
    body: [
      "To prepare a mock interviewer that asks about your own work, run your rounds, and write your feedback and scores.",
      "To show your profile summary, your progress and, only if you opt in, your place on a leaderboard.",
      "To keep the service secure and working, and to understand which features help people (product analytics and error reports).",
    ],
  },
  {
    title: "Who we share it with",
    body: [
      "Service providers that host InterviewIQ and run its speech and AI processing, only to provide the service.",
      "If you practise through your college, its placement cell may see your progress there.",
      "We don't sell your data. Companies don't see your profile or results unless a future feature asks for your explicit consent first.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "Disconnect any source at any time from Connections; its imported data is removed.",
      "Download everything we hold about you, or delete your account, from Settings.",
    ],
  },
  {
    title: "Changes",
    body: ["If this policy changes in a way that matters, we'll say so on this page and in the app before it takes effect."],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="InterviewIQ runs mock interviews built on your own resume and coding profiles. This page explains what that means for your data."
      updated="25 October 2026"
      sections={SECTIONS}
    />
  );
}
