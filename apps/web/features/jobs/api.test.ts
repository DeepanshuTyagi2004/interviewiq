import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client/client";
import { getJd, listJds } from "./api";

vi.mock("@/lib/api-client/client", () => ({ apiFetch: vi.fn() }));
describe("practice template DTO mapping", () => {
  it("removes confidence, salary and experience claims from simulated list and detail responses", async () => {
    const template = { id: "template", practiceTemplate: true, title: "Practice", dataConfidence: "high", dataAvailability: "rich", ctcMinLpa: 25, ctcMaxLpa: 50, yoeMin: 2, yoeMax: 5 };
    const real = { ...template, id: "real", practiceTemplate: false };
    vi.mocked(apiFetch).mockResolvedValueOnce([template, real]).mockResolvedValueOnce(template);
    const list = await listJds();
    // Pay and evidence are dropped; the experience range (the level's typical one) is kept.
    expect(list[0]).toMatchObject({ practiceTemplate: true, dataConfidence: null, dataAvailability: "none", ctcMinLpa: null, ctcMaxLpa: null, yoeMin: 2, yoeMax: 5 });
    expect(list[1]).toEqual(real);
    expect(await getJd("template")).toEqual(list[0]);
    expect(template.dataConfidence).toBe("high");
  });
});
