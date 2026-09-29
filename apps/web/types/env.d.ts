declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_URL: string;
    NEXTAUTH_URL: string;
    NEXTAUTH_SECRET: string;
    NEXT_PUBLIC_POSTHOG_KEY?: string;
    NEXT_PUBLIC_POSTHOG_HOST?: string;
    NEXT_PUBLIC_SENTRY_DSN?: string;
    RAZORPAY_WEBHOOK_SECRET?: string;
    GITHUB_WEBHOOK_SECRET?: string;
  }
}
