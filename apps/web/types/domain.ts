// Domain types — keep aligned with backend models.
export type UserRole = "student" | "admin" | "recruiter";

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

// TODO: add Job, Loop, Interview, Session, Report shapes
