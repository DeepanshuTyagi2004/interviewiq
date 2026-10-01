import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { pinoHttp } from "pino-http";
import type { Container } from "./container.js";
import { ApiError, InvalidArgumentError } from "./lib/errors.js";
import { security } from "./http/security.js";
import { router, sendError, userId } from "./http/support.js";
import { adminCompaniesRouter, adminUsersRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { companiesRouter, experiencesRouter, jdsRouter } from "./routes/catalogue.js";
import { githubConnectionRouter, leetcodeConnectionRouter } from "./routes/connections.js";
import { intelligenceRouter, interviewAgentBenchRouter, interviewPrepBenchRouter, resumeBenchRouter } from "./routes/intelligence.js";
import { internalRouter } from "./routes/internal.js";
import { interviewsRouter } from "./routes/interviews.js";
import { candidateProfileRouter, usersRouter } from "./routes/users.js";
import { UnknownUserError } from "./services/profileService.js";

export function createApp(c: Container): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Spring matched paths case-sensitively; so must we (see router() in http/support.ts).
  app.set("case sensitive routing", true);

  app.use(
    pinoHttp({
      logger: c.log,
      autoLogging: { ignore: (req) => req.url === "/api/v1/main/healthcheck" },
      // Paths only: OAuth callbacks carry one-time codes in the query string.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split("?")[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Same defaults Spring Security added to every response.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
    next();
  });

  app.use(
    cors({
      origin: c.config.frontendUrl,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      // Not CORS-safelisted: without this the web app can't read how long a 429 lasts.
      exposedHeaders: ["Retry-After"],
    }),
  );
  app.use(cookieParser());
  // Authenticate before parsing bodies (an anonymous malformed body is a 401, like Spring).
  app.use(security(c.jwt));
  // Session outcomes and agent plans can be large.
  app.use(express.json({ limit: "5mb" }));

  // --- routes (all mounted exactly where the Spring controllers were) ---
  app.get("/api/v1/main/healthcheck", (_req, res) => {
    res.type("text/plain").send("Server Up");
  });
  app.use(authRouter(c));

  const v1 = router();
  v1.use("/users/me", candidateProfileRouter(c));
  v1.use("/users", usersRouter(c));
  v1.get("/profile/me", async (req, res) => {
    try {
      res.json(await c.profiles.getProfile(userId(req)));
    } catch (err) {
      if (err instanceof UnknownUserError) {
        sendError(res, 404, "user_not_found", err.message);
        return;
      }
      throw err;
    }
  });
  v1.use("/connections/github", githubConnectionRouter(c));
  v1.use("/connections/leetcode", leetcodeConnectionRouter(c));
  v1.use("/companies", companiesRouter(c));
  v1.use("/jds", jdsRouter(c));
  v1.use("/experiences", experiencesRouter(c));
  v1.use("/interviews", interviewsRouter(c));
  v1.use("/intelligence/interview-prep", interviewPrepBenchRouter(c));
  v1.use("/intelligence/interview-agent", interviewAgentBenchRouter(c));
  v1.use("/intelligence/resume", resumeBenchRouter(c));
  v1.use("/intelligence", intelligenceRouter(c));
  v1.use("/admin/companies", adminCompaniesRouter(c));
  v1.use("/admin/users", adminUsersRouter(c));
  v1.use("/internal", internalRouter(c));
  app.use("/api/v1", v1);

  app.use((_req, res) => sendError(res, 404, "not_found", "no such endpoint"));
  app.use(globalErrorHandler(c));
  return app;
}

/** Last-resort mapping for errors no router claimed. */
function globalErrorHandler(c: Container) {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof ApiError) return sendError(res, err.status, err.code, err.message);
    // Multipart limits fire during parsing, before any route logic runs.
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return sendError(res, 413, "resume_too_large", "The résumé must be 6 MB or smaller.");
      return sendError(res, 400, "bad_request", err.message);
    }
    const type = (err as { type?: string } | null)?.type;
    if (type === "entity.parse.failed") return sendError(res, 400, "bad_request", "malformed JSON request body");
    if (type === "entity.too.large") return sendError(res, 413, "payload_too_large", "request body too large");
    if (err instanceof InvalidArgumentError) return sendError(res, 400, "bad_request", err.message);

    c.log.error({ err, path: req.path }, "unhandled error");
    return sendError(res, 500, "internal_error", "something went wrong");
  };
}
