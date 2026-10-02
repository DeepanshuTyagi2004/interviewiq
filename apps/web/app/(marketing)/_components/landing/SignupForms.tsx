"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

const brandButton =
  "flex items-center justify-center whitespace-nowrap rounded-full bg-brand text-sm text-brand-foreground hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const lineButton =
  "flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line-3 bg-card text-[13.5px] text-foreground hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const emailInput =
  "min-w-0 rounded-full border bg-card px-4 text-foreground outline-none placeholder:text-faint focus:border-faint";

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
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor={emailId} className="sr-only">
          Email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter email"
          className={cn(emailInput, "h-[46px] flex-1 border-line-3 text-[14.5px]")}
        />
        <button type="submit" className={cn(brandButton, "h-[46px] px-4 sm:px-[18px]")}>
          Start for free
        </button>
      </form>
      <p className="m-0 text-xs text-faint">or</p>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <button type="button" onClick={() => login()} className={lineButton}>
          Sign up with Google
        </button>
        <Link href={ROUTES.signup} className={lineButton}>
          Start with your resume
        </Link>
      </div>
      <p className="m-0 text-[11.5px] text-faint">
        By signing up, I agree to InterviewIQ&apos;s{" "}
        <a href="#" className="text-muted-foreground underline">
          Terms
        </a>{" "}
        and{" "}
        <a href="#" className="text-muted-foreground underline">
          Privacy Policy
        </a>
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
        className={cn(emailInput, "h-11 border-line-4 text-sm")}
      />
      <button type="submit" className={cn(brandButton, "h-11")}>
        Get started for free
      </button>
    </form>
  );
}
