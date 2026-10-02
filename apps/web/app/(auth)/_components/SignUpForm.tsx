"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/components/patterns";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { AuthHeading } from "./AuthHeading";
import { authErrorMessage } from "./errors";
import { FormAlert } from "./FormAlert";
import { GoogleButton, OrDivider } from "./GoogleButton";
import { PasswordInput } from "./PasswordInput";
import { signUpSchema, type SignUpValues } from "./schemas";
import { SubmitButton } from "./SubmitButton";
import { useRedirectWhenSignedIn } from "./useRedirectWhenSignedIn";

/** Create an account with Google or name + email + password; new accounts continue to onboarding. */
export function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signUp } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  useRedirectWhenSignedIn(ROUTES.onboarding);

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: params.get("email") ?? "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signUp(values);
      router.replace(ROUTES.onboarding);
    } catch (err) {
      // Field-specific failures go next to the field; the rest above the button.
      if (err instanceof ApiFetchError && (err.code === "email_taken" || err.code === "use_google")) {
        form.setError("email", { message: authErrorMessage(err) });
      } else {
        setServerError(authErrorMessage(err));
      }
    }
  });

  return (
    <>
      <AuthHeading
        eyebrow="Create account"
        title="Start rehearsing the real interview"
        description="Free to start. One click, then your resume."
      />
      <div className="mt-2">
        <GoogleButton />
      </div>
      <OrDivider />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[18px]">
        <FormField label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" placeholder="Aarav Sharma" className="h-11 text-[14.5px]" {...form.register("name")} />
        </FormField>
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
        <FormField label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters">
          <PasswordInput id="password" autoComplete="new-password" className="h-11 text-[14.5px]" {...form.register("password")} />
        </FormField>
        {serverError ? <FormAlert>{serverError}</FormAlert> : null}
        <SubmitButton pending={isSubmitting} pendingLabel="Creating account">
          Create account
        </SubmitButton>
      </form>
      <p className="m-0 text-center text-[13.5px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={ROUTES.login} className="text-foreground underline underline-offset-[3px]">
          Log in
        </Link>
      </p>
      <p className="m-0 text-center text-[11.5px] text-faint">
        By signing up, I agree to the{" "}
        <a href="#" className="text-muted-foreground underline">
          Terms
        </a>{" "}
        and{" "}
        <a href="#" className="text-muted-foreground underline">
          Privacy Policy
        </a>
        .
      </p>
    </>
  );
}
