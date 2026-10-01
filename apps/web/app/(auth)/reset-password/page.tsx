import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthColumn } from "../_components/AuthSplit";
import { ResetPasswordForm } from "../_components/ResetPasswordForm";

// The link's one-time token is in the URL — don't leak it via the Referer header.
export const metadata: Metadata = { title: "Choose a new password · InterviewIQ", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <AuthColumn>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthColumn>
  );
}
