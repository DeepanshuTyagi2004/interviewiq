import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SCORE_FIXTURE } from "../test-fixtures";
import { ScoreBreakdown } from "./ScoreBreakdown";

it("shows partial URL provenance and repeated claim attribution without implying employment verification", async () => {
  const snapshot = structuredClone(SCORE_FIXTURE);
  const evidence = snapshot.evidence[0]!;
  evidence.source = "linkedin";
  evidence.confidence = 45;
  evidence.paths = ["resume.experience[0].bullets[0]", "fragments.linkedin.profile.experience[0].bullets[0]"];
  evidence.provenance = [{ section: "experience", path: "profile.experience.0.bullets.0", file: null, quote: "Owned a service migration" }];
  snapshot.sources = [{ source: "linkedin", status: "partial", fetchedAt: snapshot.asOf, ageDays: 0,
    contentHash: "minimal-hash", importMethod: "url", provider: "exa", retrievedAt: snapshot.asOf, importedAt: snapshot.calculatedAt }];
  render(<ScoreBreakdown snapshot={snapshot} />);
  await userEvent.setup().click(screen.getByText("Evidence & component breakdown"));
  expect(screen.getByText(/Public URL snapshot via exa/)).toBeVisible();
  expect(screen.getByText(/not verified employment/)).toBeVisible();
  expect(screen.getByText(/Shared claim paths:.*counted once/)).toBeVisible();
  expect(screen.getByText(/profile.experience.0.bullets.0:/)).toBeVisible();
  expect(screen.getByText(/linkedin · self reported/)).toBeVisible();
});
