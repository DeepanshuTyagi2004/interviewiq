import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, appendCapped, filterEvents, initialAfterSeq, olderPageQuery } from "./event-filters";
import { makeEvent } from "./testing";

const EVENTS = [
  makeEvent({ seq: 1, level: "debug", level_rank: 10, type: "span.start", company_id: "c1", node: "resolve" }),
  makeEvent({ seq: 2, level: "warn", level_rank: 30, message: "Meesho is slow", company_id: "c1", node: "resolve" }),
  makeEvent({ seq: 3, level: "error", level_rank: 40, type: "span.end", company_id: "c2", node: "write_draft" }),
];

describe("filterEvents", () => {
  it("filters by minimum level, company, node, type prefix and case-insensitive text", () => {
    const seqs = (f: Partial<typeof DEFAULT_FILTERS>) => filterEvents(EVENTS, { ...DEFAULT_FILTERS, ...f }).map((e) => e.seq);
    expect(seqs({})).toEqual([1, 2, 3]);
    expect(seqs({ minLevel: "warn" })).toEqual([2, 3]);
    expect(seqs({ companyId: "c1" })).toEqual([1, 2]);
    expect(seqs({ node: "write_draft" })).toEqual([3]);
    expect(seqs({ type: "span." })).toEqual([1, 3]);
    expect(seqs({ q: "MEESHO" })).toEqual([2]);
  });
});

describe("appendCapped", () => {
  it("dedupes by seq, keeps ascending order and drops the OLDEST beyond the cap", () => {
    const merged = appendCapped([makeEvent({ seq: 1 }), makeEvent({ seq: 2 })], [makeEvent({ seq: 2 }), makeEvent({ seq: 3 })], 2);
    expect(merged.map((e) => e.seq)).toEqual([2, 3]);
  });
  it("returns the same array when there is nothing new", () => {
    const prev = [makeEvent({ seq: 1 })];
    expect(appendCapped(prev, [], 10)).toBe(prev);
  });
});

describe("paging (opening a run with more than CONSOLE_MAX_ROWS events)", () => {
  it("starts the tail at the newest rows, not the first", () => {
    expect(initialAfterSeq(5000, 2000)).toBe(3000);
    expect(initialAfterSeq(120, 2000)).toBe(0);
  });
  it("asks for the page just before the oldest loaded row, until the first event is loaded", () => {
    expect(olderPageQuery(3001, 500)).toEqual({ beforeSeq: 3001, limit: 500 });
    expect(olderPageQuery(1, 500)).toBeNull();
    expect(olderPageQuery(null, 500)).toBeNull();
  });
});
