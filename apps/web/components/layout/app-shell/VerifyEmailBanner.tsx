"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client/client";
import { ApiFetchError } from "@/lib/api-client/errors";
import { AUTH_ENDPOINTS } from "@/lib/constants/shared";

/** Slim reminder for password accounts whose email isn't confirmed yet, with a resend action. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const resend = useMutation({
    mutationFn: () => apiFetch<void>(AUTH_ENDPOINTS.resendVerification, { method: "POST" }),
    onSuccess: () => toast.success(`Verification link sent to ${email}.`),
    onError: (err) =>
      toast.error(
        err instanceof ApiFetchError && err.code === "rate_limited"
          ? "Too many requests — try again in a little while."
          : "Couldn't send the link. Please try again.",
      ),
  });

  return (
    <div role="status" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-stone px-4 py-2.5 text-[13px] sm:px-7">
      <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-ink" />
      <span className="min-w-0 flex-1 text-ink-2">
        Confirm your email — we sent a link to <span className="text-ink">{email}</span>.
      </span>
      <button
        type="button"
        onClick={() => resend.mutate()}
        disabled={resend.isPending}
        className="rounded-sm text-ink underline underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-stone disabled:opacity-50"
      >
        {resend.isPending ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
