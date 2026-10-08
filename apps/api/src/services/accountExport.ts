import type { CandidateProfileDoc } from "../db/mongo/client.js";
import type { InterviewSessionRow } from "../db/pg/schema.js";
import type { CandidateProfileRepository, ProfileFragmentRepository } from "../repositories/mongo.js";
import type {
  GitHubConnectionRepository,
  InterviewSessionRepository,
  LeetCodeConnectionRepository,
  PlatformConnectionRepository,
  UserRepository,
} from "../repositories/pg.js";
import type { PreferencesResponse, PreferencesService } from "./preferencesService.js";
import { toUserResponse, type UserResponse } from "./userService.js";
import type { ProfileScoringRepository } from "../repositories/profileScoring.js";
import type { LinkedInImportDoc, LinkedInImportRepository } from "../repositories/linkedinImports.js";

const BLUEPRINTS_NOTE = "Interview blueprints (the interviewer's preparation material) are not included; each session carries its briefing (prepBriefing).";

export interface AccountExport {
  exportedAt: string;
  notes: string[];
  user: UserResponse & { createdAt: string };
  preferences: PreferencesResponse;
  candidateProfile: Omit<CandidateProfileDoc, "_id"> | null;
  connections: {
    github: { login: string; scope: string; connectedAt: Date; lastRefreshedAt: Date | null; status: string | null } | null;
    leetcode: { username: string; status: string; connectedAt: Date; lastRefreshedAt: Date | null } | null;
    platforms: { platform: string; handle: string; status: string; discoveredFrom: string | null; connectedAt: Date; lastRefreshedAt: Date | null }[];
  };
  profileFragments: { source: string; data: Record<string, unknown>; version: number; fetchedAt: Date }[];
  interviewSessions: InterviewSessionRow[];
  profileScoring: Awaited<ReturnType<ProfileScoringRepository["export"]>>;
  linkedinImportDrafts: Omit<LinkedInImportDoc, "_id">[];
}

function withoutId<T extends { _id: unknown }>(doc: T): Omit<T, "_id"> {
  const copy: Partial<T> = { ...doc };
  delete copy._id;
  return copy as Omit<T, "_id">;
}

/** "Export my data": everything this API stores about the user, minus secrets (hashes, tokens, Google subject). */
export class AccountExportService {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: PreferencesService,
    private readonly candidateProfiles: CandidateProfileRepository,
    private readonly github: GitHubConnectionRepository,
    private readonly leetcode: LeetCodeConnectionRepository,
    private readonly fragments: ProfileFragmentRepository,
    private readonly sessions: InterviewSessionRepository,
    private readonly scoring: ProfileScoringRepository,
    private readonly linkedinImports?: LinkedInImportRepository,
    private readonly platforms?: PlatformConnectionRepository,
  ) {}

  async export(userId: string): Promise<AccountExport | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    const [preferences, profile, github, leetcode, fragments, sessions] = await Promise.all([
      this.preferences.get(userId),
      this.candidateProfiles.findByUserId(userId),
      this.github.findByUserId(userId),
      this.leetcode.findByUserId(userId),
      this.fragments.findByUserId(userId),
      this.sessions.findAllByCandidateIdOrderByScheduledAtDesc(userId),
    ]);
    const platforms = (await this.platforms?.findByUserId(userId)) ?? [];

    return {
      exportedAt: new Date().toISOString(),
      notes: [BLUEPRINTS_NOTE],
      user: { ...toUserResponse(user), createdAt: user.createdAt.toISOString() },
      preferences,
      candidateProfile: profile ? withoutId(profile) : null,
      connections: {
        github: github
          ? { login: github.githubLogin, scope: github.scope, connectedAt: github.connectedAt, lastRefreshedAt: github.lastRefreshedAt, status: github.status }
          : null,
        leetcode: leetcode
          ? { username: leetcode.username, status: leetcode.status, connectedAt: leetcode.connectedAt, lastRefreshedAt: leetcode.lastRefreshedAt }
          : null,
        platforms: platforms.map((p) => ({ platform: p.platform, handle: p.handle, status: p.status, discoveredFrom: p.discoveredFrom, connectedAt: p.connectedAt, lastRefreshedAt: p.lastRefreshedAt })),
      },
      profileFragments: fragments.map((f) => ({ source: f.source, data: f.data, version: f.version, fetchedAt: f.fetchedAt })),
      interviewSessions: sessions,
      profileScoring: await this.scoring.export(userId),
      linkedinImportDrafts: (await this.linkedinImports?.export(userId) ?? []).map(withoutId),
    };
  }
}
