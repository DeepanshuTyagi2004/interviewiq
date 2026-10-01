import { ApiFetchError } from "@/lib/api-client/errors";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_taken: "An account with this email already exists. Log in instead.",
  use_google: "This email signs in with Google. Continue with Google instead.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  invalid_token: "This link is invalid or has expired. Request a new one.",
};

/** Human copy for an auth failure, keyed on the API's stable error code. */
export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiFetchError) {
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    if (err.code === "invalid_request") return err.message;
  }
  if (err instanceof TypeError) return "Couldn't reach InterviewIQ. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
