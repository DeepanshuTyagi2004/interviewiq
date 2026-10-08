import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProcess, updateProcess } from "./api";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("process write levels", () => {
  beforeEach(() => fetchMock.mockReset());
  it("rejects external free-form values before a request", async () => {
    await expect(Reflect.apply(createProcess, null, [{ name: "Practice", level: "Career switcher" }])).rejects.toThrow("valid engineering level");
    await expect(Reflect.apply(updateProcess, null, ["p-1", { level: "SDE I" }])).rejects.toThrow("valid engineering level");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends canonical values and preserves unrelated update payloads", async () => {
    await createProcess({ name: "Practice", level: "intern" });
    await updateProcess("p-1", { level: "distinguished" });
    await updateProcess("p-1", { name: "Renamed" });
    expect(fetchMock.mock.calls.map(([, options]) => options.json)).toEqual([{ name: "Practice", level: "intern" }, { level: "distinguished" }, { name: "Renamed" }]);
  });
});
