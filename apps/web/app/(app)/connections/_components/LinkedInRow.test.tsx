import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFetchError } from "@/lib/api-client/client";
import type { CandidateProfileResponse } from "@/features/onboarding/types";
import type { LinkedInImportDraft, LinkedInImportStatus } from "@/features/linkedin/types";
import { LinkedInRow } from "./LinkedInRow";
import { PROVIDERS } from "./providers";
import { confirmLinkedIn, importLinkedInPdf, getLinkedInStatus, removeLinkedIn } from "@/features/linkedin/api";

vi.mock("@/features/linkedin/api", async (original) => ({
  ...await original<typeof import("@/features/linkedin/api")>(),
  confirmLinkedIn: vi.fn(), importLinkedInPdf: vi.fn(), getLinkedInStatus: vi.fn(), removeLinkedIn: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/onboarding", () => ({ useCandidateProfile: () => ({ data: profileState.current, isSuccess: profileState.ready }) }));

const saved: CandidateProfileResponse = {
  fullName: "Owner", email: null, phone: null, location: null, headline: "My existing headline", level: "sde2",
  targetRole: "Platform engineer", targetJdId: null, education: [], experience: [], projects: [], skills: ["SQL"],
  achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null,
  resumeParsedAt: null, onboardingComplete: false,
};
const profileState = { current: saved as CandidateProfileResponse | null, ready: true };
const sourceUrl = "https://www.linkedin.com/in/my-profile/";
const disconnected: LinkedInImportStatus = { connected: false, importedAt: null, method: null, sourceUrl: null, provider: null, retrievedAt: null, sections: [], warnings: [] };
const imported: LinkedInImportStatus = { connected: true, importedAt: "2026-10-04T10:00:00Z", method: "pdf", sourceUrl, provider: null, retrievedAt: null, sections: ["headline", "skills"], warnings: [] };
const legacy: LinkedInImportStatus = { ...imported, method: "url", provider: "firecrawl", retrievedAt: "2026-10-04T09:59:00Z" };
const makeDraft = (): LinkedInImportDraft => ({
  id: "draft-1", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  method: "pdf", sourceUrl, provider: null, retrievedAt: null, profileRevision: "revision-1", profile: { ...saved, headline: "Imported headline", level: null, skills: ["sql", "TypeScript", "TypeScript"] },
  sections: [
    { key: "headline", label: "Headline", entries: ["Imported headline"], sourceFile: "Profile.pdf" },
    { key: "skills", label: "Skills", entries: ["SQL", "TypeScript"], sourceFile: "Profile.pdf" },
  ], warnings: ["No supported evidence was found for: About, Experience."],
});
const pdf = (name = "Profile.pdf", size = 1024, type = "application/pdf") => {
  const file = new File(["%PDF-1.4"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

function setup(resumeLinkedInUrl?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidation = vi.spyOn(client, "invalidateQueries");
  const row = () => <QueryClientProvider client={client}><ul><LinkedInRow provider={PROVIDERS.find((p) => p.source === "LINKEDIN")!} resumeLinkedInUrl={resumeLinkedInUrl} /></ul></QueryClientProvider>;
  const result = render(row());
  return { ...result, client, invalidation, refresh: () => result.rerender(row()) };
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("LinkedIn PDF file"), { target: { files: [file] } });
}

async function openAndUpload(file = pdf()) {
  fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
  choose(file);
  fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
  fireEvent.click(screen.getByRole("button", { name: "Read PDF" }));
  await screen.findByRole("heading", { name: "Review LinkedIn import" });
}

beforeEach(() => {
  vi.clearAllMocks(); profileState.current = saved; profileState.ready = true;
  vi.mocked(getLinkedInStatus).mockResolvedValue(disconnected);
  vi.mocked(importLinkedInPdf).mockResolvedValue(makeDraft());
  vi.mocked(confirmLinkedIn).mockResolvedValue({ profile: null, import: imported });
  vi.mocked(removeLinkedIn).mockResolvedValue(undefined);
});

describe("LinkedIn PDF import", () => {
  it("shows the Save to PDF steps with an own-profile link and never fetches LinkedIn", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Import LinkedIn profile");
    expect(screen.getByRole("region", { name: "Get your LinkedIn PDF" })).toBeVisible();
    expect(screen.getByText("Resources")).toBeVisible();
    expect(screen.getByText("Save to PDF")).toBeVisible();
    expect(screen.getByText(/desktop browser/)).toBeVisible();
    const link = screen.getByRole("link", { name: /Open my LinkedIn profile/ });
    expect(link).toHaveAttribute("href", "https://www.linkedin.com/in/me/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(importLinkedInPdf).not.toHaveBeenCalled();
  });

  it("deep-links step 1 to the canonical resume LinkedIn URL when one is known", () => {
    profileState.current = { ...saved, detectedLinks: { ...saved.detectedLinks, linkedin: "https://linkedin.com/in/Resume-Owner?trk=resume" } };
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    expect(screen.getByRole("link", { name: /Open my LinkedIn profile/ })).toHaveAttribute("href", "https://www.linkedin.com/in/Resume-Owner/");
  });

  it.each(["https://linkedin.com/company/acme", "https://linkedin.com.evil.test/in/me", "not-a-url"])("never links an unsafe resume URL: %s", (linkedin) => {
    profileState.current = { ...saved, detectedLinks: { ...saved.detectedLinks, linkedin } };
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    expect(screen.getByRole("link", { name: /Open my LinkedIn profile/ })).toHaveAttribute("href", "https://www.linkedin.com/in/me/");
  });

  it("requires both a PDF and explicit consent before uploading once", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    expect(screen.getByRole("button", { name: "Read PDF" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
    expect(screen.getByRole("button", { name: "Read PDF" })).toBeDisabled();
    // Not "Profile.pdf": the download instructions already mention that name.
    const file = pdf("asha-linkedin.pdf");
    choose(file);
    expect(screen.getByText("asha-linkedin.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Read PDF" }));
    await screen.findByRole("heading", { name: "Review LinkedIn import" });
    expect(importLinkedInPdf).toHaveBeenCalledTimes(1);
    expect(importLinkedInPdf).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(confirmLinkedIn).not.toHaveBeenCalled();
  });

  it.each([
    [pdf("resume.docx", 1024, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "Choose the PDF file"],
    [pdf("Profile.pdf", 6 * 1024 * 1024), "5 MB or smaller"],
  ])("rejects a wrong file type or oversize PDF before upload", (file, message) => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    choose(file);
    fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Read PDF" })).toBeDisabled();
    expect(importLinkedInPdf).not.toHaveBeenCalled();
  });

  it("dispatches only once while reading is pending", async () => {
    vi.mocked(importLinkedInPdf).mockImplementationOnce(() => new Promise(() => {}));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    choose(pdf());
    fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Read PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Read PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Reading…" }));
    expect(importLinkedInPdf).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Reading your PDF");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("points a non-LinkedIn PDF back to the steps without creating a source", async () => {
    vi.mocked(importLinkedInPdf).mockRejectedValue(new ApiFetchError(422, "linkedin_pdf_unrecognized", "unrecognized"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    choose(pdf("resume.pdf"));
    fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
    fireEvent.click(screen.getByRole("button", { name: "Read PDF" }));
    await screen.findByText(/doesn't look like LinkedIn's Save to PDF file/);
    expect(importLinkedInPdf).toHaveBeenCalledTimes(1);
    expect(confirmLinkedIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Review LinkedIn import" })).not.toBeInTheDocument();
  });

  it("shows PDF provenance, warnings and preserves source-only by default", async () => {
    const { invalidation } = setup();
    await openAndUpload();
    expect(screen.getByText(/Source: LinkedIn PDF \(Profile\.pdf\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /my-profile/ })).toHaveAttribute("href", sourceUrl);
    expect(screen.getByRole("link", { name: /my-profile/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Profile link in the PDF/)).toBeInTheDocument();
    expect(screen.getByText("No supported evidence was found for: About, Experience.")).toBeInTheDocument();
    expect(screen.getByText(/Missing sections: about, experience/)).toBeInTheDocument();
    expect(screen.getByText(/self-reported, not independently verified/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Also merge/ })).not.toBeChecked();
    expect(confirmLinkedIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Headline" }));
    vi.mocked(getLinkedInStatus).mockResolvedValue(imported);
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected sections" }));
    await waitFor(() => expect(confirmLinkedIn).toHaveBeenCalledWith("draft-1", ["skills"], false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["candidate-profile", "me"] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["profile", "me"] });
    expect(await screen.findByText("PDF snapshot")).toBeInTheDocument();
    expect(screen.getByText(/LinkedIn PDF snapshot · Not live synced · imported/)).toBeInTheDocument();
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("keeps legacy Firecrawl snapshots readable and replaces them with a PDF upload", async () => {
    vi.mocked(getLinkedInStatus).mockResolvedValue(legacy);
    setup();
    expect(await screen.findByText("Public snapshot")).toBeInTheDocument();
    expect(screen.getByText(/Firecrawl public-profile snapshot · Not live synced · retrieved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace LinkedIn snapshot" }));
    expect(screen.getByRole("link", { name: /Open my LinkedIn profile/ })).toHaveAttribute("href", sourceUrl);
    expect(screen.getByLabelText("LinkedIn PDF file")).toBeInTheDocument();
    expect(importLinkedInPdf).not.toHaveBeenCalled();
  });

  it("previews a deduplicated non-overwriting merge and retains the explicitly chosen engineering level", async () => {
    setup(); await openAndUpload();
    fireEvent.click(screen.getByRole("checkbox", { name: /Also merge/ }));
    expect(screen.getByRole("region", { name: "Profile merge preview" })).toBeInTheDocument();
    expect(screen.getByText(/Keep current engineering level: sde2/)).toBeInTheDocument();
    expect(screen.getByText(/Keep existing headline/)).toBeInTheDocument();
    expect(screen.getByText("Existing (keep): SQL")).toBeInTheDocument();
    expect(screen.getByText("Append / fill blank: TypeScript")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected sections" }));
    await waitFor(() => expect(confirmLinkedIn).toHaveBeenCalledWith("draft-1", ["headline", "skills"], true));
    expect(saved.level).toBe("sde2"); expect(saved.headline).toBe("My existing headline");
  });

  it("disables merging if the current profile has not been loaded, while allowing source-only", async () => {
    profileState.ready = false; profileState.current = null;
    setup(); await openAndUpload();
    expect(screen.getByRole("checkbox", { name: /Also merge/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm selected sections" })).toBeEnabled();
  });

  it("never links an unsafe source URL returned in a draft", async () => {
    vi.mocked(importLinkedInPdf).mockResolvedValue({ ...makeDraft(), sourceUrl: "https://linkedin.com.evil.test/in/me" });
    setup(); await openAndUpload();
    expect(screen.queryByRole("link", { name: /evil/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Profile link in the PDF/)).not.toBeInTheDocument();
  });

  it("requires at least one selected section and never confirms on cancellation", async () => {
    setup(); await openAndUpload();
    fireEvent.click(screen.getByRole("checkbox", { name: "Headline" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Skills" }));
    expect(screen.getByRole("button", { name: "Confirm selected sections" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmLinkedIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not reopen a dismissed dialog when a submitted confirmation completes", async () => {
    let finish!: (value: Awaited<ReturnType<typeof confirmLinkedIn>>) => void;
    vi.mocked(confirmLinkedIn).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { invalidation } = setup(); await openAndUpload();
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected sections" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.mocked(getLinkedInStatus).mockResolvedValue(imported);
    await act(async () => { finish({ profile: null, import: imported }); });
    expect(await screen.findByText("PDF snapshot")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirmLinkedIn).toHaveBeenCalledTimes(1);
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["profile-scoring"] });
  });

  it("does not save with all sections unchecked or unsupported/empty extracted evidence", async () => {
    const empty = makeDraft();
    // Deliberately malformed runtime response: outside the generated wire enum.
    empty.sections = [{ key: "contacts", label: "Contacts", entries: ["ignored"], sourceFile: null }, { key: "skills", label: "Skills", entries: [], sourceFile: null }] as unknown as LinkedInImportDraft["sections"];
    vi.mocked(importLinkedInPdf).mockResolvedValue(empty);
    setup(); await openAndUpload();
    expect(screen.getByText(/Unsupported sections skipped: Contacts/)).toBeInTheDocument();
    expect(screen.getByText(/No supported sections were found in this PDF/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm selected sections" })).toBeDisabled();
    expect(confirmLinkedIn).not.toHaveBeenCalled();
  });

  it("shows actionable profile conflict errors without retrying confirmation", async () => {
    vi.mocked(confirmLinkedIn).mockRejectedValue(new ApiFetchError(409, "linkedin_profile_changed", "changed"));
    setup(); await openAndUpload();
    fireEvent.click(screen.getByRole("button", { name: "Confirm selected sections" }));
    await screen.findByText(/Your profile changed during review/);
    expect(confirmLinkedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Confirm selected sections" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Upload a different PDF" }));
    expect(screen.getByRole("button", { name: "Read PDF" })).toBeDisabled();
  });

  it("rejects expired drafts", async () => {
    vi.mocked(importLinkedInPdf).mockResolvedValue({ ...makeDraft(), expiresAt: "2020-01-01T00:00:00Z" });
    setup(); await openAndUpload();
    expect(screen.getByText(/This draft expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm selected sections" })).toBeDisabled();
  });

  it("cancels a pending upload and ignores an old response after opening a new import", async () => {
    let finish!: (draft: LinkedInImportDraft) => void;
    vi.mocked(importLinkedInPdf).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    choose(pdf());
    fireEvent.click(screen.getByRole("checkbox", { name: /This is my own LinkedIn profile/ }));
    fireEvent.click(screen.getByRole("button", { name: "Read PDF" }));
    const signal = vi.mocked(importLinkedInPdf).mock.calls[0]![1];
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Import LinkedIn" }));
    await act(async () => { finish(makeDraft()); });
    expect(screen.getByRole("heading", { name: "Import LinkedIn profile" })).toBeInTheDocument();
    expect(confirmLinkedIn).not.toHaveBeenCalled();
  });

  it("requires a themed removal confirmation, preserves merged fields and invalidates freshness", async () => {
    vi.mocked(getLinkedInStatus).mockResolvedValue(imported);
    const { invalidation } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Remove LinkedIn source" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Remove LinkedIn source?");
    expect(screen.getByText(/Details already merged into your editable profile remain/)).toBeInTheDocument();
    expect(removeLinkedIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeLinkedIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove LinkedIn source" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove source" }));
    await waitFor(() => expect(removeLinkedIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invalidation.mock.calls.some(([arg]) => arg?.queryKey?.[0] === "profile-scoring")).toBe(true);
    expect(saved.skills).toEqual(["SQL"]);
  });
});
