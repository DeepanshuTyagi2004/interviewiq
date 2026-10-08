import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCandidateProfile } from "./api";
import { formToRequest } from "./mapping";
import { emptyCandidateForm } from "./form";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("candidate profile level writes", () => {
  beforeEach(() => fetchMock.mockReset());
  it("rejects free-form external input and unset completion before a request", async () => {
    const draft = formToRequest(emptyCandidateForm, false);
    await expect(Reflect.apply(saveCandidateProfile, null, [{ ...draft, level: "Senior / Staff" }])).rejects.toThrow("valid engineering level");
    await expect(saveCandidateProfile({ ...draft, complete: true })).rejects.toThrow("Choose your engineering level");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows null unfinished drafts and canonical completion", async () => {
    const draft = formToRequest(emptyCandidateForm, false);
    await saveCandidateProfile(draft);
    await saveCandidateProfile({ ...draft, level: "principal", complete: true });
    expect(fetchMock.mock.calls[0][1].json.level).toBeNull();
    expect(fetchMock.mock.calls[1][1].json.level).toBe("principal");
  });
});
