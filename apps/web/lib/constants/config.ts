export const APP_CONFIG = {
  name: "InterviewIQ",
  description: "Interview preparation platform",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
} as const;
