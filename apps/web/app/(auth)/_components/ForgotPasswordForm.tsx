"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/components/patterns";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth/client";
import { ROUTES } from "@/lib/constants/shared";
import { AuthHeading } from "./AuthHeading";
import { authErrorMessage } from "./errors";
import { FormAlert } from "./FormAlert";
import { forgotPasswordSchema, type ForgotPasswordValues } from "./schemas";
import { SubmitButton } from "./SubmitButton";

/** Emails are only logged by the API until a mail provider is chosen — say so outside production. */
const DEV_MAIL_NOTE = process.env.NODE_ENV !== "production";

/** Request a reset link. The response is identical whether or not the account exists. */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setServerError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      setServerError(authErrorMessage(err));
    }
  });

  return (
    <>
      <AuthHeading
        eyebrow="Reset password"
        title="Forgot your password?"
        description="Enter your email and we'll send you a link to choose a new one."
      />
      {sentTo ? (
        <FormAlert tone="success">
          If an account exists for <strong className="font-medium">{sentTo}</strong>, a reset link is on its way. It
          expires in an hour.
          {DEV_MAIL_NOTE ? " (Development: the link is printed in the API console.)" : null}
        </FormAlert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[18px]">
          <FormField label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" placeholder="you@college.edu" className="h-11 text-[14.5px]" {...form.register("email")} />
          </FormField>
          {serverError ? <FormAlert>{serverError}</FormAlert> : null}
          <SubmitButton pending={isSubmitting} pendingLabel="Sending link">
            Send reset link
          </SubmitButton>
        </form>
      )}
      <p className="m-0 text-center text-[13.5px] text-muted-foreground">
        Remembered it?{" "}
        <Link href={ROUTES.login} className="text-foreground underline underline-offset-[3px]">
          Log in
        </Link>
      </p>
    </>
  );
}
