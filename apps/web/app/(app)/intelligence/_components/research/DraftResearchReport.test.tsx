import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompanyDraft, DraftField } from "@/features/research";
import { makeCompany } from "@/features/research/testing";
import { DraftResearchReport } from "./DraftResearchReport";

const field = (value: unknown): DraftField => ({ value, confidence: "high", provenance: "evidence", source_urls: [], note: null });
function makeDraft(extra: Record<string, unknown> = {}): CompanyDraft {
  return {
    draft_id: "draft-1", company_id: "company-1", run_id: "run-1", version: 2,
    status: "pending_review", created_at: "2026-10-02T00:00:00Z", conflicts: [], diff: [],
    snapshot: { identity: { name: field("Meesho"), website: field(null), aliases: field([]) }, ...extra },
  };
}

describe("DraftResearchReport", () => {
  it("renders future nested snapshot fields, evidence metadata and complete raw JSON", () => {
    const draft = makeDraft({
      profile: { headquarters: field({ city: "Bengaluru", offices: [{ location: "Remote", active: false, count: 0 }] }) },
      future_findings: { custom: { value: ["One", { detail: "Nested finding" }], confidence: "low", provenance: "derived", note: "Needs confirmation", source_urls: ["https://example.com/source"], new_metadata: "Preserved" } },
    });
    render(<DraftResearchReport draft={draft} company={makeCompany()} />);
    const profile = screen.getByRole("region", { name: "Profile" });
    expect(within(profile).getByText("Bengaluru")).toBeInTheDocument();
    expect(within(profile).getByText("false")).toBeInTheDocument();
    expect(within(profile).getByText("0")).toBeInTheDocument();
    const future = screen.getByRole("region", { name: "Future findings" });
    expect(within(future).getByText("Nested finding")).toBeInTheDocument();
    expect(within(future).getByText("low")).toBeInTheDocument();
    expect(within(future).getByText("derived")).toBeInTheDocument();
    expect(within(future).getByText("Needs confirmation")).toBeInTheDocument();
    expect(within(future).getByText("Preserved")).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
    const raw = screen.getByText("Raw snapshot · complete JSON").closest("details")!;
    expect(raw).not.toHaveAttribute("open");
    expect(JSON.parse(raw.querySelector("pre")!.textContent!)).toEqual(draft.snapshot);
    expect(screen.queryByRole("region", { name: "Company profile" })).not.toBeInTheDocument();
  });

  it("explicitly marks absent or empty research sections as unavailable", () => {
    render(<DraftResearchReport draft={makeDraft({ profile: { summary: field(null) }, roles: [] })} company={makeCompany()} />);
    for (const name of ["Company profile", "Compensation / culture", "Roles / interview processes"]) {
      const section = screen.getByRole("region", { name });
      expect(within(section).getByText("Unavailable")).toBeInTheDocument();
      expect(within(section).getByText("Not available in this draft snapshot.")).toBeInTheDocument();
    }
  });

  it("shows how much of the tracked research the draft covers", () => {
    render(<DraftResearchReport draft={{ ...makeDraft(), coverage: { filled: 18, total: 34, missing: ["profile.hq"] } }} company={makeCompany()} />);
    expect(screen.getByText("Coverage")).toBeInTheDocument();
    expect(screen.getByText("18/34")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("only makes http and https evidence URLs clickable", () => {
    const draft = makeDraft({ sources: { ...field("Source evidence"), source_urls: ["https://example.com/a", "http://example.com/b", "javascript:alert(1)", "data:text/html,unsafe", "//example.com/c", "not a URL"] } });
    const { container } = render(<DraftResearchReport draft={draft} company={makeCompany()} />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.com/a", "http://example.com/b"]);
    for (const link of links) expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(screen.getByRole("region", { name: "Sources" })).getByText("javascript:alert(1)")).toBeInTheDocument();
  });
});
