import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthSplit } from "../_components/AuthSplit";
import { SignInForm } from "../_components/SignInForm";

export const metadata: Metadata = { title: "Log in · InterviewIQ" };

export default function LoginPage() {
  return (
    <AuthSplit>
      {/* useSearchParams (?next, ?error, ?email) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthSplit>
  );
}
