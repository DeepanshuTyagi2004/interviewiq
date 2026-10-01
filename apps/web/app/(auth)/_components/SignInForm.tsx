"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/components/patterns";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";
import { AuthHeading } from "./AuthHeading";
import { authErrorMessage } from "./errors";
import { FormAlert } from "./FormAlert";
import { GoogleButton, OrDivider } from "./GoogleButton";
import { PasswordInput } from "./PasswordInput";
import { signInSchema, type SignInValues } from "./schemas";
import { SubmitButton } from "./SubmitButton";
import { safeNextPath, useRedirectWhenSignedIn } from "./useRedirectWhenSignedIn";

/** Log in with Google or email + password; returns to `?next=` when it's a local path. */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useAuth();
  const next = safeNextPath(params.get("next"));
  const [serverError, setServerError] = useState<string | null>(
    params.get("error") ? "Google sign-in didn't complete. Please try again." : null,
  );
  useRedirectWhenSignedIn(next);

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: params.get("email") ?? "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn(values);
      router.replace(next);
    } catch (err) {
      setServerError(authErrorMessage(err));
    }
  });

  return (
    <>
      <AuthHeading eyebrow="Log in" title="Welcome back" description="Pick up where you left off." />
      <div className="mt-2">
        <GoogleButton />
      </div>
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[18px]">
        <FormField label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@college.edu"
            className="h-11 text-[14.5px]"
            {...form.register("email")}
          />
        </FormField>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-[13px] text-muted-foreground">
              Password
            </label>
            <Link href={ROUTES.forgotPassword} className="text-[13px] text-muted-foreground underline underline-offset-[3px]">
              Forgot?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            className="h-11 text-[14.5px]"
            {...form.register("password")}
          />
          {errors.password ? (
            <p role="alert" className="m-0 text-xs text-destructive">
              {errors.password.message}
            </p>
          ) : null}
        </div>
        {serverError ? <FormAlert>{serverError}</FormAlert> : null}
        <SubmitButton pending={isSubmitting} pendingLabel="Logging in">
          Log in
        </SubmitButton>
      </form>
      <p className="m-0 text-center text-[13.5px] text-muted-foreground">
        New to InterviewIQ?{" "}
        <Link href={ROUTES.signup} className="text-foreground underline underline-offset-[3px]">
          Create an account
        </Link>
      </p>
    </>
  );
}
