import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DataAvailability, JdSummary } from "@/features/jobs";
import { CompanyCard } from "./CompanyCard";
import { buildCompanyEntries } from "./library";

function jd(id: string, availability: DataAvailability, title = `Role ${id}`): JdSummary {
  return {
    id,
    company: "meesho",
    companyName: "Meesho",
    role: "software-engineer",
    level: "fresher",
    title,
    specialization: "backend",
    dataConfidence: null,
    dataAvailability: availability,
  };
}

function entryOf(jds: JdSummary[]) {
  return buildCompanyEntries([{ id: "m", slug: "meesho", name: "Meesho", tier: 2, logoUrl: null, headquarterLocation: null, companySize: null }], jds)[0];
}

describe("CompanyCard", () => {
  it("opens the single live role, with a LIVE status and real depth", () => {
    const { container } = render(
      <CompanyCard entry={entryOf([jd("a", "rich", "SDE I Backend"), jd("b", "none")])} onShowRoles={vi.fn()} />,
    );
    expect(screen.getByRole("article", { name: "Meesho" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open sde i backend/i })).toHaveAttribute("href", "/jobs/a");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-seg="on"]')).toHaveLength(5);
    expect(screen.getByText("2 roles · 1 live")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 roles researched")).toBeInTheDocument();
  });

  it("asks to choose a role when several are live", () => {
    const onShowRoles = vi.fn();
    render(<CompanyCard entry={entryOf([jd("a", "rich"), jd("b", "available")])} onShowRoles={onShowRoles} />);
    fireEvent.click(screen.getByRole("button", { name: /choose from 2 roles/i }));
    expect(onShowRoles).toHaveBeenCalledWith("meesho");
  });

  it("has no notify-me control and no action for a company without roles", () => {
    const { container } = render(<CompanyCard entry={entryOf([])} onShowRoles={vi.fn()} />);
    expect(screen.getByText("Researching")).toBeInTheDocument();
    expect(screen.getByText("0/5")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-seg="on"]')).toHaveLength(0);
    // Not live: the status dot is steady grey, never a pulse.
    expect(container.querySelector("[data-motion]")).toBeNull();
    expect(screen.getByText("No roles yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing to open yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/notify/i)).not.toBeInTheDocument();
  });
});
