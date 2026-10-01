import type { Router } from "express";
import type { Container } from "../container.js";
import { str } from "../domain/candidateProfile.js";
import { LeetCodeProfileError } from "../integrations/leetcode/errors.js";
import { errorMessage, InvalidArgumentError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import { routerErrors, userId, router } from "../http/support.js";

/** GitHub Profile Builder connection (OAuth App — separate from Google login). */
export function githubConnectionRouter(c: Container): Router {
  const r = router();

  /**
   * The GitHub authorize URL as JSON. The frontend fetches it with its Bearer token and then
   * navigates — a top-level navigation here couldn't carry the in-memory token.
   */
  r.get("/authorize", (req, res) => {
    res.json({ url: c.githubOAuth.buildAuthorizeUrl(userId(req)) });
  });

  /**
   * GitHub redirects here with code+state (no JWT — the signed state binds the user). Exchange,
   * store, fetch synchronously, then send the browser back to the frontend connections page.
   */
  r.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error !== null || code === null || state === null) {
      res.redirect(302, withQuery(c.config.connectionsRedirect, "error", error ?? "github_oauth_failed"));
      return;
    }
    try {
      const connection = await c.githubOAuth.completeConnection(code, state);
      await c.profiles.refreshGitHub(connection); // synchronous fetch on connect
      res.redirect(302, c.config.connectionsRedirect);
    } catch (err) {
      c.log.warn(`GitHub connect callback failed: ${errorMessage(err)}`);
      res.redirect(302, withQuery(c.config.connectionsRedirect, "error", "github_connect_failed"));
    }
  });

  /** Disconnect: delete the connection + GitHub fragment. */
  r.delete("/", async (req, res) => {
    await c.profiles.disconnectGitHub(userId(req));
    res.status(204).end();
  });

  return r;
}

/**
 * LeetCode connection: no OAuth — connect validates the username synchronously, then collects in
 * the background (202 SYNCING; the UI polls the profile for the terminal status).
 */
export function leetcodeConnectionRouter(c: Container): Router {
  const r = router();

  r.post("/", async (req, res) => {
    const username = isObject(req.body) ? str(req.body.username) : null;
    const connection = await c.leetcode.connect(userId(req), username);
    res.status(202).json({ username: connection.username, status: connection.status });
  });

  r.delete("/", async (req, res) => {
    await c.leetcode.disconnect(userId(req));
    res.status(204).end();
  });

  r.use(
    routerErrors((err) => {
      if (err instanceof LeetCodeProfileError) {
        // Bad username / private are user-facing; transport problems are logged, not detailed.
        if (err.httpStatus === 503) c.log.warn(`LeetCode connect transient failure (${err.code}): ${err.message}`);
        return { status: err.httpStatus, code: err.code, message: err.message };
      }
      if (err instanceof InvalidArgumentError) return { status: 400, code: "leetcode_bad_request", message: err.message };
      return undefined;
    }),
  );
  return r;
}

function withQuery(base: string, key: string, value: string): string {
  const url = new URL(base);
  url.searchParams.set(key, value);
  return url.toString();
}
