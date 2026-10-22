"use client";

import { useEffect } from "react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Dev hosting (Render free) sleeps the API and ai-service when idle. One no-auth request per page load starts them early, on any
 * page including login and marketing, so a visitor who signs in and starts a round does not wait for a cold start. Best effort:
 * the result is ignored, and always-on hosts just answer 204. */
export function WakeServices() {
  useEffect(() => {
    void fetch(`${BASE_URL}/api/v1/main/wake`, { cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}
