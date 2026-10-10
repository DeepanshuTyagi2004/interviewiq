import { afterEach, describe, expect, it, vi } from "vitest";
import { NODE_PRESETS } from "@/features/loops/presets";
import { createNodeDragPreview } from "./nodeDragPreview";

describe("createNodeDragPreview", () => {
  afterEach(() => vi.restoreAllMocks());

  it("labels a round as 45 min, even if the preset still holds another length", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const round = NODE_PRESETS.find((node) => node.kind === "round")!;
    const preview = createNodeDragPreview({ ...round, durationMinutes: 60 });
    expect(preview.textContent).toBe(`${round.label}${round.kind === "round" ? round.type : ""} · 45 min`);
    preview.remove();
  });
});
