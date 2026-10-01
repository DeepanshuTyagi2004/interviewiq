import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthColumn } from "../_components/AuthSplit";
import { VerifyEmailStatus } from "../_components/VerifyEmailStatus";

// The link's one-time token is in the URL — don't leak it via the Referer header.
export const metadata: Metadata = { title: "Confirm your email · InterviewIQ", referrer: "no-referrer" };

export default function VerifyEmailPage() {
  return (
    <AuthColumn>
      <Suspense fallback={null}>
        <VerifyEmailStatus />
      </Suspense>
    </AuthColumn>
  );
}
