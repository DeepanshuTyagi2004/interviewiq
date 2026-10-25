import { ApiFetchError } from "@/lib/api-client/errors";
import { INTERVIEW_ACCESS_TEXT } from "@/components/auth/InterviewAccessNote";

/** Turns the API's stable error codes into something a person can act on. */
export function bookingError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiFetchError) {
    switch (err.code) {
      case "session_slot_taken": return "You already have an interview at that time. Pick another slot.";
      case "round_locked": return "Complete the earlier rounds first.";
      case "round_already_booked": return "That round is already booked.";
      case "round_already_completed": return "That round is already completed.";
      case "loop_not_active": return "This track is paused or finished.";
      case "session_slot_in_past": return "That slot is in the past.";
      case "session_not_reschedulable": return "This interview can no longer be moved.";
      case "interview_access_required": return INTERVIEW_ACCESS_TEXT;
      case "session_not_cancellable": return "This interview can no longer be cancelled.";
    }
  }
  return fallback;
}
