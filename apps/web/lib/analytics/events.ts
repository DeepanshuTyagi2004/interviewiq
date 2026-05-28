export const EVENTS = {
  SIGNUP_COMPLETED: "signup_completed",
  INTERVIEW_STARTED: "interview_started",
  INTERVIEW_COMPLETED: "interview_completed",
  // TODO: add product event names
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
