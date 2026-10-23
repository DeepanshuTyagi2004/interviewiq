import type { Metadata } from "next";
import { ScoreExplainer } from "@/features/profile-scoring/components/ScoreExplainer";

export const metadata: Metadata = {
  title: "How your profile score works · InterviewIQ",
};

export default function ProfileScorePage() {
  return <ScoreExplainer />;
}
