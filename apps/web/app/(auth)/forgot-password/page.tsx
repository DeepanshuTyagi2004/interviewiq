import type { Metadata } from "next";
import { AuthColumn } from "../_components/AuthSplit";
import { ForgotPasswordForm } from "../_components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password · InterviewIQ" };

export default function ForgotPasswordPage() {
  return (
    <AuthColumn>
      <ForgotPasswordForm />
    </AuthColumn>
  );
}
