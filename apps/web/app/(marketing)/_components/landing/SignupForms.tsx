"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

const brandButton =
  "iq-brand-glass flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const lineButton =
  "iq-glass-btn flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const emailInput =
  "min-w-0 rounded-full bg-card/70 px-5 text-foreground shadow-ring outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The email field is a head start on sign-up: submitting carries the address to the sign-up form
 * (as `?email=`) where the visitor picks a password or continues with Google.
 */
function useStartFree() {
  const router = useRouter();
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get("email");
    const query = typeof email === "string" && email.trim() ? `?email=${encodeURIComponent(email.trim())}` : "";
    router.push(`${ROUTES.signup}${query}`);
  };
}

/** Hero sign-up block: email + "Start for free", then Google / resume alternatives. */
export function HeroSignup() {
  const { login } = useAuth();
  const onSubmit = useStartFree();
  const emailId = useId();

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 min-[460px]:flex-row">
        <label htmlFor={emailId} className="sr-only">
          Email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter email"
          className={cn(emailInput, "h-[54px] min-[460px]:flex-1 text-[15px]")}
        />
        <button type="submit" className={cn(brandButton, "h-[54px] px-5 min-[460px]:px-6")}>
          Start for free
        </button>
      </form>
      <p className="m-0 text-xs text-faint">or</p>
      <button type="button" onClick={() => login()} className={lineButton}>
        Sign up with Google
      </button>
      <p className="m-0 text-xs text-faint">
        By signing up, I agree to InterviewIQ&apos;s{" "}
        <Link href={ROUTES.terms} className="text-muted-foreground underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href={ROUTES.privacy} className="text-muted-foreground underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

/** Closing CTA: stacked email + "Get started for free". */
export function CtaSignup() {
  const onSubmit = useStartFree();
  const emailId = useId();

  return (
    <form onSubmit={onSubmit} className="mt-1.5 flex max-w-[340px] flex-col gap-2">
      <label htmlFor={emailId} className="sr-only">
        Email
      </label>
      <input
        id={emailId}
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Enter email"
        className={cn(emailInput, "h-12 text-sm")}
      />
      <button type="submit" className={cn(brandButton, "h-12")}>
        Get started for free
      </button>
    </form>
  );
}
