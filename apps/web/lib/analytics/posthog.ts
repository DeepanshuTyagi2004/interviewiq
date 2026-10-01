"use client";

import posthog from "posthog-js";
import { redactProperties } from "./redact";

let initialized = false;

export function initPostHog() {
  if (initialized || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: false,
    // Verify / reset links carry one-time tokens in the URL; never ship them to analytics.
    before_send: (event) => (event ? { ...event, properties: redactProperties(event.properties ?? {}) } : event),
  });
  initialized = true;
}

export { posthog };
