import { parsePreferencesPatch, resolvePreferences, toSetPaths, type Preferences } from "../domain/preferences.js";
import type { UserPreferencesRepository } from "../repositories/mongo.js";

/** The wire shape: every setting resolved, plus when the user last changed one (null = never). */
export type PreferencesResponse = Preferences & { updatedAt: string | null };

export class PreferencesService {
  constructor(private readonly repo: UserPreferencesRepository) {}

  async get(userId: string): Promise<PreferencesResponse> {
    const doc = await this.repo.findByUserId(userId);
    return { ...resolvePreferences(doc), updatedAt: doc ? doc.updatedAt.toISOString() : null };
  }

  /** Validate a partial patch (400 invalid_preferences), persist only its leaves, return the full set. */
  async update(userId: string, body: unknown): Promise<PreferencesResponse> {
    const paths = toSetPaths(parsePreferencesPatch(body));
    if (Object.keys(paths).length === 0) return this.get(userId);
    const doc = await this.repo.setPaths(userId, paths, new Date());
    return { ...resolvePreferences(doc), updatedAt: doc.updatedAt.toISOString() };
  }
}
