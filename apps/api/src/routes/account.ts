import type { Router } from "express";
import { z } from "zod";
import type { Container } from "../container.js";
import { requiredBody, router, routerErrors, userId } from "../http/support.js";
import { clientIp, enforceRateLimit, rateLimitErrors } from "../http/rateLimit.js";
import { BadRequestError } from "../lib/errors.js";
import {
  ConfirmationMismatchError,
  DeletionUnavailableError,
  InterviewInProgressError,
  InvalidPasswordError,
} from "../services/accountDeletion.js";
import { toUserResponse } from "../services/userService.js";
import { clearRefreshTokenCookie } from "./auth.js";

const UpdateUserBody = z.object(
  {
    name: z
      .string({ error: "Enter your name." })
      .trim()
      .min(1, { error: "Enter your name." })
      .max(80, { error: "Name must be at most 80 characters." }),
  },
  { error: "The request body must be a JSON object." },
);

const DeleteAccountBody = z.object(
  {
    confirmEmail: z.string({ error: "Type your email to confirm." }).min(1, { error: "Type your email to confirm." }).max(254),
    password: z.string().max(128).optional(),
  },
  { error: "The request body must be a JSON object." },
);

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestError(r.error.issues[0]?.message ?? "Invalid request.", code);
  return r.data;
}

/**
 * Settings under /api/v1/users/me: preferences, display name, sessions, data export and account
 * deletion. Mounted before the candidate-profile and users routers; paths it doesn't own fall
 * through to them.
 */
export function accountRouter(c: Container): Router {
  const r = router();

  r.get("/preferences", async (req, res) => {
    res.json(await c.preferences.get(userId(req)));
  });

  r.patch("/preferences", async (req, res) => {
    res.json(await c.preferences.update(userId(req), requiredBody(req)));
  });

  /** Display name. Google sign-ins no longer overwrite it (UserRepository.upsertByGoogleSub). */
  r.patch("/", async (req, res) => {
    const { name } = parse(UpdateUserBody, requiredBody(req), "invalid_name");
    const user = await c.users.rename(userId(req), name);
    if (!user) {
      res.status(404).end();
      return;
    }
    res.json(toUserResponse(user));
  });

  /** "Log out of all devices" — this one included. */
  r.post("/sessions/revoke", async (req, res) => {
    await c.refreshTokens.revokeAll(userId(req));
    clearRefreshTokenCookie(res, c.config);
    res.status(204).end();
  });

  /** Settings → Privacy & data → Export: a JSON attachment of everything the API holds. */
  r.get("/export", async (req, res) => {
    const data = await c.accountExport.export(userId(req));
    if (!data) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="interviewiq-export-${data.exportedAt.slice(0, 10)}.json"`);
    res.json(data);
  });

  /** Immediate hard delete (AccountDeletionService). Password checks share the login rate limit. */
  r.delete("/", async (req, res) => {
    const uid = userId(req);
    const input = parse(DeleteAccountBody, requiredBody(req), "invalid_request");
    enforceRateLimit(c.rateLimiters.loginPerIpEmail, `${clientIp(req)}|delete-account|${uid}`);
    const deleted = await c.accountDeletion.delete(uid, input);
    if (!deleted) {
      res.status(404).end();
      return;
    }
    clearRefreshTokenCookie(res, c.config);
    res.status(204).end();
  });

  r.use(rateLimitErrors);
  r.use(
    routerErrors((err) => {
      if (err instanceof ConfirmationMismatchError) {
        return { status: 400, code: "confirmation_mismatch", message: "The email you typed doesn't match this account." };
      }
      if (err instanceof InvalidPasswordError) return { status: 403, code: "invalid_password", message: "That password isn't right." };
      if (err instanceof InterviewInProgressError) {
        return { status: 409, code: "interview_in_progress", message: "Finish or leave your live interview first." };
      }
      if (err instanceof DeletionUnavailableError) {
        return { status: 502, code: "deletion_unavailable", message: "We couldn't reach every service, so nothing was deleted. Please try again." };
      }
      return undefined;
    }),
  );
  return r;
}
