import { ApiError } from "../lib/errors.js";
import type { UserRepository } from "../repositories/pg.js";

/**
 * Who may give mock interviews (spec 2026-10-21): CANDIDATE and ADMIN. The role is read from the
 * database on every call, never from the access token, so a promotion works at once and a stale
 * token cannot grant or keep access.
 */
export const interviewAccessRequired = () =>
  new ApiError(403, "interview_access_required", "Interview access has not been granted to your account yet. Ask an admin.");

export class InterviewAccess {
  constructor(private readonly users: Pick<UserRepository, "findById">) {}

  async assertCanInterview(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || (user.role !== "CANDIDATE" && user.role !== "ADMIN")) throw interviewAccessRequired();
  }
}
