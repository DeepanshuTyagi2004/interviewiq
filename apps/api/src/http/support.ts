import { type ErrorRequestHandler, type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import type { AuthPrincipal } from "../auth/jwt.js";
import { ApiError, BadRequestError, InvalidArgumentError, resumeTooLarge } from "../lib/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the security middleware for authenticated requests. */
      auth?: AuthPrincipal;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every router is CASE-SENSITIVE (Express defaults to insensitive). Otherwise `/api/v1/ADMIN/...`
 * would route to the admin handlers while slipping past the path-based role check.
 */
export function router(): Router {
  return Router({ caseSensitive: true });
}

/** The authenticated user's id (the JWT `sub`). Only call behind the security middleware. */
export function userId(req: Request): string {
  if (!req.auth) throw new ApiError(401, "unauthorized", "authentication required");
  return req.auth.userId;
}

/** A UUID path parameter (400 when malformed, like Spring's `@PathVariable UUID`). */
export function uuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new BadRequestError(`${name} must be a UUID`);
  return v.toLowerCase();
}

export function stringParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string") throw new BadRequestError(`missing path parameter ${name}`);
  return v;
}

/** Optional string query param (first value if repeated). */
export function queryString(req: Request, name: string): string | null {
  const v = (req.query as Record<string, unknown>)[name];
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
  return typeof v === "string" ? v : null;
}

/** Integer query param with a default (400 when not an integer, like `@RequestParam long`). */
export function queryInt(req: Request, name: string, def: number): number {
  const v = queryString(req, name);
  if (v === null || v.trim() === "") return def;
  if (!/^[-+]?\d+$/.test(v.trim())) throw new BadRequestError(`${name} must be an integer`);
  return Number.parseInt(v.trim(), 10);
}

/**
 * The request body, which must be present (Spring's required `@RequestBody`). express.json() turns
 * an EMPTY body into `{}`, so presence is decided from the headers, not from `req.body`.
 */
export function requiredBody(req: Request): unknown {
  const length = req.headers["content-length"];
  const hasBody = req.headers["transfer-encoding"] !== undefined || (length !== undefined && Number(length) > 0);
  if (!hasBody || req.body === undefined) throw new BadRequestError("Required request body is missing");
  return req.body;
}

// --- resume uploads ------------------------------------------------------------------------------

/** Authoritative resume cap. The multipart limit below is a slightly higher backstop. */
export const MAX_RESUME_BYTES = 6 * 1024 * 1024;

export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  defParamCharset: "utf8", // non-ASCII filenames like "resume.pdf"
}).single("file");

export const MAX_LINKEDIN_PDF_BYTES = 5 * 1024 * 1024;

/** LinkedIn "Save to PDF" upload: one file plus the `consent` field. Limits fire as MulterError. */
export const linkedinPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LINKEDIN_PDF_BYTES, files: 1, fields: 2, fieldSize: 16 },
  defParamCharset: "utf8",
}).single("file");

/** The uploaded LinkedIn PDF, checked by magic bytes (not the client-supplied type). */
export function readLinkedInPdf(req: Request): { bytes: Buffer; filename: string | null } {
  const file = req.file;
  if (!file || file.size === 0) throw new ApiError(400, "linkedin_pdf_missing", "Choose the PDF you downloaded from LinkedIn.");
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ApiError(415, "linkedin_pdf_unsupported_media", "Upload the PDF from LinkedIn's Save to PDF.");
  return { bytes: file.buffer, filename: file.originalname || null };
}

/** Shared resume validation (present / size / looks like a PDF). Returns the bytes + filename. */
export function readResume(req: Request): { bytes: Buffer; filename: string | null } {
  const file = req.file;
  if (!file || file.size === 0) throw new InvalidArgumentError("the resume file is empty");
  if (file.size > MAX_RESUME_BYTES) throw resumeTooLarge();
  const filename = file.originalname || null;
  const looksPdf = (file.mimetype ?? "").toLowerCase().includes("pdf") || (filename ?? "").toLowerCase().endsWith(".pdf");
  if (!looksPdf) throw new InvalidArgumentError("please upload a PDF resume");
  return { bytes: file.buffer, filename };
}

// --- error rendering -----------------------------------------------------------------------------

export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ code, message });
}

/**
 * Build a router-level error handler (the per-controller `@ExceptionHandler`s). `map` returns the
 * response for errors this router owns, or undefined to defer to the global handler.
 */
export function routerErrors(map: (err: unknown) => { status: number; code: string; message: string } | undefined): ErrorRequestHandler {
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ApiError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    const mapped = map(err);
    if (mapped) {
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }
    next(err);
  };
}
