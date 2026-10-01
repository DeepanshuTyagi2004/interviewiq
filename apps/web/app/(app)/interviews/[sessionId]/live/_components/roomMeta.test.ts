import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { formatElapsed, roomEyebrow, roomMetaFrom } from "./roomMeta";

describe("room display helpers", () => {
  it("formats elapsed time as mm:ss, adding hours when needed", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(247_900)).toBe("04:07");
    expect(formatElapsed(3_729_000)).toBe("1:02:09");
    expect(formatElapsed(-5)).toBe("00:00");
  });

  it("builds the room eyebrow from the session, with a plain fallback", () => {
    expect(roomEyebrow(undefined)).toBe("Interview room");
    const meta = roomMetaFrom({ company: "meesho", companyName: "Meesho", level: "sde1", roundType: "dsa" } as InterviewSession);
    expect(meta).toEqual({ company: "Meesho", level: "SDE I", round: "DSA" });
    expect(roomEyebrow(meta)).toBe("Meesho · SDE I · DSA");
  });
});
