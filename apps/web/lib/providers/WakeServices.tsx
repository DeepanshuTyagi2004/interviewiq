"use client";

import { useEffect, useRef, useState } from "react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** An answer slower than this means the API is asleep (or gone): show the pill while we keep waiting. */
const SLOW_MS = 4_000;
/** Give up on one request after this long and send another. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Wait between failed attempts. */
const RETRY_MS = 5_000;
/** Down this long: stop saying "waking up" and say we can't reach it. */
const UNREACHABLE_AFTER_MS = 90_000;
/** Back on a tab hidden this long: the API may have gone to sleep meanwhile, so check again. */
const RECHECK_AFTER_HIDDEN_MS = 5 * 60_000;

type ApiStatus = "checking" | "up" | "down";

/** Dev hosting (Render free) sleeps the API and ai-service when idle. One no-auth request per page load starts them early, on any
 * page including login and marketing, so a visitor who signs in and starts a round does not wait for a cold start. While the API
 * does not answer, a small pill says so (and the page's buttons that wait on it make sense); it is never shown while the API is up.
 * Always-on hosts just answer 204 and nothing is shown. */
export function WakeServices() {
  const [status, setStatus] = useState<ApiStatus>("checking");
  const [downSince, setDownSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const runRef = useRef(0);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenAt: number | null = null;

    // Ping until the API answers. A newer run cancels an older one.
    async function probe() {
      const run = ++runRef.current;
      if (retryTimer) clearTimeout(retryTimer);
      setStatus("checking");
      while (run === runRef.current) {
        const controller = new AbortController();
        const slow = setTimeout(() => markDown(run), SLOW_MS);
        const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let up = false;
        try {
          const res = await fetch(`${BASE_URL}/api/v1/main/wake`, { cache: "no-store", signal: controller.signal });
          // A 5xx is the host's proxy answering for a sleeping or starting API; a 429 still means it is up.
          up = res.status < 500;
        } catch {
          up = false;
        } finally {
          clearTimeout(slow);
          clearTimeout(abort);
        }
        if (run !== runRef.current) return;
        if (up) {
          setStatus("up");
          setDownSince(null);
          return;
        }
        markDown(run);
        await new Promise<void>((resolve) => {
          retryTimer = setTimeout(resolve, RETRY_MS);
        });
      }
    }

    function markDown(run: number) {
      if (run !== runRef.current) return;
      const at = Date.now();
      setStatus("down");
      setDownSince((t) => t ?? at);
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > RECHECK_AFTER_HIDDEN_MS) {
        hiddenAt = null;
        void probe();
      }
    }

    void probe();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      runRef.current += 1;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Tick while down so the copy can switch from "waking up" to "can't reach".
  useEffect(() => {
    if (status !== "down") return;
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, [status]);

  if (status !== "down") return null;
  const unreachable = downSince !== null && now - downSince > UNREACHABLE_AFTER_MS;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4"
    >
      <div className="flex max-w-full items-center gap-2.5 rounded-full border border-line bg-card px-4 py-2 text-[13px] text-foreground shadow-float">
        <span aria-hidden className="relative flex h-2 w-2 flex-none">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <span className="min-w-0">
          {unreachable
            ? "Can't reach the server. Still retrying…"
            : "Server is waking up. This can take up to a minute."}
        </span>
      </div>
    </div>
  );
}
