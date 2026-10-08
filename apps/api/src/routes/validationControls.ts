import type { Container } from "../container.js";
import { router, routerErrors, userId } from "../http/support.js";
import { ApiError } from "../lib/errors.js";
import { z } from "zod";

const patchSchema = z.object({
  linkedinImportEnabled: z.boolean().optional(),
  requireSectionReview: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one setting is required");

export function adminValidationControlsRouter(c: Container) {
  const r = router();
  r.get("/", async (_req, res) => res.json(await c.repos.validationControls.get()));
  r.patch("/", async (req, res) => {
    if (!req.is("application/json")) throw new ApiError(415, "validation_controls_unsupported_media", "Use JSON to update validation controls.");
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "validation_controls_invalid", "Validation controls must contain at least one known boolean setting.");
    res.json(await c.repos.validationControls.patch(parsed.data, userId(req)));
  });
  r.use(routerErrors(() => ({ status: 503, code: "validation_controls_unavailable", message: "Validation controls are temporarily unavailable." })));
  return r;
}
