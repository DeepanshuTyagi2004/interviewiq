import { describe, expect, it } from "vitest";
import { slugify } from "../../src/domain/slug.js";

// Mirrored verbatim in apps/ai-service/tests/research/test_identity.py: a slug joins Postgres rows,
// briefs and research fixture folders, so both languages must agree exactly.
const CASES: Array<[string, string]> = [
  ["Meesho", "meesho"],
  ["  Big   Co ", "big-co"],
  ["Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"],
  ["AT&T", "at-and-t"],
  ["Café Coffee Day", "cafe-coffee-day"],
  ["Straße Labs", "strae-labs"],
];

describe("slugify", () => {
  it.each(CASES)("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});
