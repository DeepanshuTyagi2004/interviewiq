import { describe, expect, it } from "vitest";
import { cleanDocument, moveRound, newRole, newRound, publicationIssues, roundEdges } from "./enrichment";

describe("enrichment document transformations", () => {
  it("reorders an immutable linear sequence, reconnects neighbors after removal and keeps IDs", () => {
    const rounds = [newRound(), newRound(), newRound()];
    const moved = moveRound(rounds, rounds[2]!.id, -1);
    expect(moved.map((r) => r.id)).toEqual([rounds[0]!.id, rounds[2]!.id, rounds[1]!.id]);
    expect(roundEdges(moved).map((e) => [e.source, e.target])).toEqual([[rounds[0]!.id, rounds[2]!.id], [rounds[2]!.id, rounds[1]!.id]]);
    expect(roundEdges(moved.filter((r) => r.id !== rounds[2]!.id))).toEqual([{ id: `${rounds[0]!.id}->${rounds[1]!.id}`, source: rounds[0]!.id, target: rounds[1]!.id }]);
    expect(moveRound(rounds, rounds[0]!.id, -1)).toBe(rounds);
    expect(moveRound(rounds, "missing", 1)).toBe(rounds);
  });
  it("requires evidence and verification for every section, with a nonempty sequence", () => {
    const role = newRole();
    const document = { company: { overview: "", culture: "", benefits: "", sourceUrls: [], verified: false }, roles: [role] };
    expect(publicationIssues(document)).toEqual(expect.arrayContaining(["Company: add at least one source URL.", "Verify company information.", "Role 1: add at least one round."]));
    expect(role).toMatchObject({ yoeMin: null, ctcMinLpa: null, verified: false, description: "" });
  });
  it("cleans multiline inputs without changing sequence IDs or verification", () => {
    const round = { ...newRound(), topics: [" Trees ", ""], sourceUrls: [" https://example.com ", ""] };
    const document = { company: { overview: "", culture: "", benefits: "", sourceUrls: [""], verified: false }, roles: [{ ...newRole(), rounds: [round] }] };
    expect(cleanDocument(document).roles[0]!.rounds[0]).toMatchObject({ id: round.id, topics: ["Trees"], sourceUrls: ["https://example.com"], verified: false });
    expect(document.roles[0]!.rounds[0]!.topics).toEqual([" Trees ", ""]);
  });
});
