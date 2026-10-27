import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakeServices } from "./WakeServices";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const answer = (status: number) => Promise.resolve(new Response(null, { status }));

describe("WakeServices", () => {
  it("shows nothing when the API answers", async () => {
    fetchMock.mockReturnValueOnce(answer(204));
    render(<WakeServices />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the pill while the API is slow to answer, and hides it once it does", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    render(<WakeServices />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("waking up");

    await act(async () => {
      resolve(new Response(null, { status: 204 }));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retries after an error or a 5xx until the API is up", async () => {
    fetchMock
      .mockReturnValueOnce(Promise.reject(new TypeError("failed")))
      .mockReturnValueOnce(answer(503))
      .mockReturnValueOnce(answer(204));
    render(<WakeServices />);
    await act(async () => {});
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it can't reach the server after a long outage", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("failed")));
    render(<WakeServices />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("waking up");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Can't reach the server");
  });
});
