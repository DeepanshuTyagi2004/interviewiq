"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/components/patterns";
import { resetPassword } from "@/lib/auth/client";
import { ROUTES } from "@/lib/constants/shared";
import { AuthHeading } from "./AuthHeading";
import { authErrorMessage } from "./errors";
import { FormAlert } from "./FormAlert";
import { PasswordInput } from "./PasswordInput";
import { resetPasswordSchema, type ResetPasswordValues } from "./schemas";
import { SubmitButton } from "./SubmitButton";

/** Choose a new password from a reset link (`?token=`). Signs out every other session. */
export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setServerError(null);
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setServerError(authErrorMessage(err));
    }
  });

  return (
    <>
      <AuthHeading eyebrow="Reset password" title="Choose a new password" description="Use at least 8 characters. You'll be signed out everywhere else." />
      {!token ? (
        <FormAlert>This reset link is missing its token. Request a new one.</FormAlert>
      ) : done ? (
        <FormAlert tone="success">Your password has been updated. Log in with your new password.</FormAlert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[18px]">
          <FormField label="New password" htmlFor="password" error={errors.password?.message}>
            <PasswordInput id="password" autoComplete="new-password" className="h-11 text-[14.5px]" {...form.register("password")} />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirm" error={errors.confirm?.message}>
            <PasswordInput id="confirm" autoComplete="new-password" className="h-11 text-[14.5px]" {...form.register("confirm")} />
          </FormField>
          {serverError ? <FormAlert>{serverError}</FormAlert> : null}
          <SubmitButton pending={isSubmitting} pendingLabel="Saving">
            Update password
          </SubmitButton>
        </form>
      )}
      <p className="m-0 text-center text-[13.5px] text-muted-foreground">
        <Link href={done ? ROUTES.login : ROUTES.forgotPassword} className="text-foreground underline underline-offset-[3px]">
          {done ? "Go to log in" : "Request a new link"}
        </Link>
      </p>
    </>
  );
}
