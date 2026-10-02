import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { makeEvent } from "./testing";
import type { ResearchEvent } from "./types";

const listRunEventsMock = vi.fn();
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  listRunEvents: (...args: unknown[]) => listRunEventsMock(...args),
}));

import { useRunEvents } from "./hooks";

const NEWEST = 5000;
const evs = (from: number, to: number): ResearchEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => makeEvent({ seq: from + i }));

/** Fake server: `afterSeq` / `beforeSeq` paging over events 1..total. */
function serve(total: number) {
  listRunEventsMock.mockImplementation(async (_runId: string, p: { afterSeq?: number; beforeSeq?: number; limit?: number }) => {
    const limit = p.limit ?? 500;
    let events: ResearchEvent[];
    if (p.beforeSeq !== undefined) events = evs(Math.max(1, p.beforeSeq - limit), p.beforeSeq - 1);
    else {
      const from = (p.afterSeq ?? 0) + 1;
      events = from > total ? [] : evs(from, Math.min(total, from + limit - 1));
    }
    return { events, last_seq: total };
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return wrapper;
}

const render = (wrapper: ReturnType<typeof setup>, runId: string) =>
  renderHook(({ id }) => useRunEvents(id, { live: false, lastSeq: NEWEST }), { wrapper, initialProps: { id: runId } });

beforeEach(() => {
  listRunEventsMock.mockReset();
  serve(NEWEST);
});

describe("useRunEvents", () => {
  it("opens at the newest 2000 rows by paging from lastSeq - 2000", async () => {
    const { result } = render(setup(), "r1");
    await waitFor(() => expect(result.current.events.length).toBe(2000));
    expect(listRunEventsMock.mock.calls[0]).toEqual(["r1", { afterSeq: 3000, limit: 500 }]);
    // Four full pages, then one empty page that ends the loop.
    expect(listRunEventsMock).toHaveBeenCalledTimes(5);
    expect(listRunEventsMock).toHaveBeenLastCalledWith("r1", { afterSeq: 5000, limit: 500 });
    expect(result.current.events[0]!.seq).toBe(3001);
    expect(result.current.events.at(-1)!.seq).toBe(5000);
    expect(result.current.canLoadOlder).toBe(true);
  });

  it("loadOlder prepends the previous page and later tail pages stop trimming", async () => {
    const { result } = render(setup(), "r1");
    await waitFor(() => expect(result.current.events.length).toBe(2000));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(listRunEventsMock).toHaveBeenLastCalledWith("r1", { beforeSeq: 3001, limit: 500 });
    expect(result.current.events.length).toBe(2500);
    expect(result.current.events[0]!.seq).toBe(2501);
  });

  it("changing runId empties the buffer and restarts from the new run's tail", async () => {
    const wrapper = setup();
    const { result, rerender } = render(wrapper, "r1");
    await waitFor(() => expect(result.current.events.length).toBe(2000));
    listRunEventsMock.mockClear();
    rerender({ id: "r2" });
    expect(result.current.events).toEqual([]);
    await waitFor(() => expect(result.current.events.length).toBe(2000));
    expect(listRunEventsMock.mock.calls[0]).toEqual(["r2", { afterSeq: 3000, limit: 500 }]);
  });

  it("refills when the run is reopened within the cache's stale window", async () => {
    const wrapper = setup();
    const first = render(wrapper, "r1");
    await waitFor(() => expect(first.result.current.events.length).toBe(2000));
    first.unmount();
    const second = render(wrapper, "r1");
    await waitFor(() => expect(second.result.current.events.length).toBe(2000));
    expect(second.result.current.events.at(-1)!.seq).toBe(5000);
  });
});
