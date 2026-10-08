"use client";

import { ApiFetchError } from "@/lib/api-client/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            // A 4xx will not change on retry (a bad id, no access): show the error at once instead of a
            // skeleton for the three backoff retries. Network and 5xx failures still retry.
            retry: (count, error) => !(error instanceof ApiFetchError && error.status >= 400 && error.status < 500) && count < 3,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === "development" ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
