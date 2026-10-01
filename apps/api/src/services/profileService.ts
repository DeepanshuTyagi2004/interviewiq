import type { GitHubConnectionRow } from "../db/pg/schema.js";
import type { GitHubCollector } from "../integrations/github/collector.js";
import type { ProfileFragmentRepository } from "../repositories/mongo.js";
import type { GitHubConnectionRepository, LeetCodeConnectionRepository, UserRepository } from "../repositories/pg.js";
import { assembleProfileBands, type NotableItem, type SkillItem } from "./profileAssembler.js";

/**
 * Per-source connection status. Null fields are OMITTED from the JSON (the Spring DTO was
 * `@JsonInclude(NON_NULL)`), e.g. `{ "source": "RESUME", "connected": false }`.
 */
export interface SourceStatus {
  source: string;
  connected: boolean;
  lastRefreshedAt?: Date;
  status?: string;
}

export interface ProfileResponse {
  user: { name: string; headline: string | null };
  sources: SourceStatus[];
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
  atAGlance: string[];
  fragments: Record<string, unknown>;
  provenance: { source: string; fragmentHash: string; fetchedAt: Date }[];
}

export class UnknownUserError extends Error {}

export class ProfileService {
  constructor(
    private readonly users: UserRepository,
    private readonly githubConnections: GitHubConnectionRepository,
    private readonly leetcodeConnections: LeetCodeConnectionRepository,
    private readonly fragments: ProfileFragmentRepository,
    private readonly githubCollector: GitHubCollector,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnknownUserError(`Unknown user: ${userId}`);

    const [fragments, github, leetcode] = await Promise.all([
      this.fragments.findByUserId(userId),
      this.githubConnections.findByUserId(userId),
      this.leetcodeConnections.findByUserId(userId),
    ]);

    const sources: SourceStatus[] = [
      status("GITHUB", github !== null, github?.lastRefreshedAt ?? null, null),
      status("RESUME", false, null, null),
      status("LEETCODE", leetcode !== null, leetcode?.lastRefreshedAt ?? null, leetcode?.status ?? null),
      status("LINKEDIN", false, null, null),
      status("X", false, null, null),
    ];

    const bands = assembleProfileBands(fragments);
    const fragmentMap: Record<string, unknown> = {};
    const provenance: ProfileResponse["provenance"] = [];
    for (const f of fragments) {
      fragmentMap[f.source.toLowerCase()] = f.data;
      provenance.push({ source: f.source, fragmentHash: `sha256:${f.contentHash}`, fetchedAt: f.fetchedAt });
    }

    return {
      user: { name: user.name, headline: null },
      sources,
      notable: bands.notable,
      mostUsedSkills: bands.mostUsedSkills,
      atAGlance: bands.atAGlance,
      fragments: fragmentMap,
      provenance,
    };
  }

  /** Fetch GitHub data now (on connect, and weekly) and stamp lastRefreshedAt. */
  async refreshGitHub(connection: GitHubConnectionRow): Promise<void> {
    await this.githubCollector.collectAndStore(connection);
    await this.githubConnections.touchRefreshed(connection.id, new Date());
  }

  async disconnectGitHub(userId: string): Promise<void> {
    await this.githubConnections.deleteByUserId(userId);
    await this.fragments.deleteByUserIdAndSource(userId, "GITHUB");
  }
}

function status(source: string, connected: boolean, lastRefreshedAt: Date | null, syncStatus: string | null): SourceStatus {
  return {
    source,
    connected,
    ...(lastRefreshedAt ? { lastRefreshedAt } : {}),
    ...(syncStatus ? { status: syncStatus } : {}),
  };
}
