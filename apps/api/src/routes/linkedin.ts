import multer from "multer";
import type { Container } from "../container.js";
import { linkedinPdfUpload, readLinkedInPdf, router, routerErrors, userId, uuidParam } from "../http/support.js";
import { ApiError } from "../lib/errors.js";

export function linkedinRouter(c: Container) {
  const r = router();
  r.get("/", async (req, res) => res.json(await c.linkedin.status(userId(req))));
  r.post("/imports", linkedinPdfUpload, async (req, res) => {
    if (!req.is("multipart/form-data")) throw new ApiError(415, "linkedin_import_unsupported_media", "Upload your LinkedIn PDF as multipart/form-data with consent=true.");
    if (req.body?.consent !== "true") throw new ApiError(400, "linkedin_consent_required", "Confirm this is your own LinkedIn profile and consent to processing the PDF. Ownership is your declaration, not independently verified.");
    res.status(201).json(await c.linkedin.create(userId(req), readLinkedInPdf(req)));
  });
  r.post("/imports/:id/confirm", async (req, res) => {
    if (!req.is("application/json")) throw new ApiError(415, "linkedin_import_unsupported_media", "Use JSON to confirm career sections.");
    res.json(await c.linkedin.confirm(userId(req), uuidParam(req, "id"), req.body));
  });
  r.delete("/", async (req, res) => { await c.linkedin.disconnect(userId(req)); res.status(204).send(); });
  // Keep DB/transport exception payloads out of the generic logger (may contain derived career data).
  r.use(routerErrors((err) => err instanceof multer.MulterError
    ? err.code === "LIMIT_FILE_SIZE"
      ? { status: 413, code: "linkedin_pdf_too_large", message: "The LinkedIn PDF must be 5 MB or smaller." }
      : { status: 400, code: "linkedin_import_invalid", message: "Upload one PDF file and consent=true." }
    : { status: 503, code: "linkedin_import_unavailable", message: "The import could not be saved. Please retry later." }));
  return r;
}
