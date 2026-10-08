import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client/client";
import { confirmLinkedIn, importLinkedInPdf, removeLinkedIn } from "./api";
import { canonicalLinkedInUrl } from "./url";

vi.mock("@/lib/api-client/client", () => ({ apiFetch: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("LinkedIn PDF requests", () => {
  it("uploads only the PDF and explicit consent as multipart, without a mutation auth retry", () => {
    const file = new File(["%PDF-1.4"], "Profile.pdf", { type: "application/pdf" });
    const signal = new AbortController().signal;
    importLinkedInPdf(file, signal);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0]!;
    expect(path).toBe("/api/v1/users/me/linkedin/imports");
    expect(init).toMatchObject({ method: "POST", signal, retryAuth: false });
    const body = (init as { body: FormData }).body;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(["consent", "file"]);
    expect(body.get("consent")).toBe("true");
    expect((body.get("file") as File).name).toBe("Profile.pdf");
  });

  it("sends only confirmed sections plus explicit merge choice, and removal uses no retry", () => {
    confirmLinkedIn("draft/1", ["skills"], false);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/users/me/linkedin/imports/draft%2F1/confirm", { method: "POST", json: { sections: ["skills"], mergeProfile: false }, retryAuth: false });
    removeLinkedIn();
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/users/me/linkedin", { method: "DELETE", retryAuth: false });
  });

  it("canonicalizes a genuine HTTPS member profile, dropping tracking query and fragments", () => {
    expect(canonicalLinkedInUrl(" https://linkedin.com/in/My-Profile_123/?trk=profile#about ")).toBe("https://www.linkedin.com/in/My-Profile_123/");
  });

  it("preserves the exact saved member slug and trailing slash for the open-profile link", () => {
    const savedUrl = "https://www.linkedin.com/in/Exact-Saved_Owner/";
    expect(canonicalLinkedInUrl(savedUrl)).toBe(savedUrl);
  });

  it.each([null, undefined, "", "   "])("does not infer a resume profile when its saved URL is missing: %s", (url) => {
    expect(canonicalLinkedInUrl(url)).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.linkedin.com/in/me", "https://linkedin.com.evil.test/in/me", "https://www.linkedin.com:443/in/me",
    "https://user:secret@www.linkedin.com/in/me", "https://evil.test/?url=https://linkedin.com/in/me", "https://linkedin.com/company/acme",
    "https://www.linkedin.com/in/me/extra", "https://www.linkedin.com/in/%2e%2e", "https://www.linkedin.com\\@evil.test/in/me",
    "https://www.linkedin.com/in/", "javascript:alert(1)", "https://www.linkedin.com./in/me", "https://uk.linkedin.com/in/me",
    "https://www.linkedin.com/in/../in/me", "https://www.linkedin.com/in/_me", `https://www.linkedin.com/in/${"a".repeat(201)}`,
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(canonicalLinkedInUrl(url)).toBeNull();
  });
});
