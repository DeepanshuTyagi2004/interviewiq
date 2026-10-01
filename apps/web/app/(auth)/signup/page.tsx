import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSplit } from "../_components/AuthSplit";
import { SignUpForm } from "../_components/SignUpForm";

export const metadata: Metadata = { title: "Create your account · InterviewIQ" };

export default function SignupPage() {
  return (
    <AuthSplit>
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </AuthSplit>
  );
}
