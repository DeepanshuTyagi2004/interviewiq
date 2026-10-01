"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { verifyEmail } from "@/lib/auth/client";
import { ROUTES } from "@/lib/constants/shared";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AuthHeading } from "./AuthHeading";
import { authErrorMessage } from "./errors";
import { FormAlert } from "./FormAlert";

/** Confirms the email from the link's `?token=` once, on arrival. */
export function VerifyEmailStatus() {
  const token = useSearchParams().get("token");
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const started = useRef(false);

  const verify = useMutation({
    mutationFn: verifyEmail,
    // Refresh the cached user so the "confirm your email" banner disappears.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
  const { mutate } = verify;

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  const pending = Boolean(token) && !verify.isSuccess && !verify.isError;

  return (
    <>
      <AuthHeading eyebrow="Verify email" title="Confirm your email" description="This keeps your account and readiness reports tied to you." />
      {!token ? (
        <FormAlert>This link is missing its token. Use the latest link we sent you.</FormAlert>
      ) : pending ? (
        <p role="status" className="m-0 flex items-center gap-2.5 text-sm text-muted-foreground">
          <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-faint border-r-transparent" />
          Confirming…
        </p>
      ) : verify.isSuccess ? (
        <FormAlert tone="success">Your email is confirmed. You&apos;re all set.</FormAlert>
      ) : (
        <FormAlert>{authErrorMessage(verify.error)}</FormAlert>
      )}
      <Link
        href={isAuthenticated ? ROUTES.dashboard : ROUTES.login}
        className="inline-flex h-11 items-center justify-center rounded-[5px] border border-line-3 text-[13.5px] transition-colors hover:border-foreground"
      >
        {isAuthenticated ? "Go to your dashboard" : "Log in"}
      </Link>
    </>
  );
}
