import { randomUUID } from "node:crypto";
import type { UpdateFilter } from "mongodb";
import type {
  CandidateProfileDoc,
  MongoCollections,
  ProfileFragmentDoc,
  UserPreferencesDoc,
} from "../db/mongo/client.js";
import type { ProfileSource } from "../domain/enums.js";
import type { EngineeringLevel } from "../domain/engineeringLevels.js";

/** MongoDB repositories (native driver). */

export class CandidateProfileRepository {
  constructor(private readonly c: MongoCollections) {}

  async deleteByUserId(userId: string): Promise<void> {
    await this.c.candidateProfiles.deleteOne({ _id: userId });
  }

  findByUserId(userId: string): Promise<CandidateProfileDoc | null> {
    return this.c.candidateProfiles.findOne({ _id: userId });
  }

  findAll(): Promise<CandidateProfileDoc[]> {
    return this.c.candidateProfiles.find().toArray();
  }

  /** Change only the chosen level. Never create a partial profile or replace other details. */
  async patchLevel(userId: string, level: EngineeringLevel | null): Promise<void> {
    const now = new Date();
    // Keep the level-only contract; a strictly increasing timestamp is also a CAS revision fence.
    await this.c.candidateProfiles.updateOne({ _id: userId }, [{ $set: { level,
      updatedAt: { $cond: [{ $gte: ["$updatedAt", now] }, { $add: ["$updatedAt", 1] }, now] } } }], { upsert: false });
  }

  /** Replace the user's profile, preserving its createdAt. */
  async save(doc: Omit<CandidateProfileDoc, "_id" | "createdAt" | "updatedAt"> & { createdAt?: Date }): Promise<CandidateProfileDoc> {
    const now = new Date();
    const { createdAt, ...fields } = doc;
    const saved = await this.c.candidateProfiles.findOneAndUpdate(
      { _id: doc.userId },
      { $set: { ...fields, updatedAt: now, revision: randomUUID() }, $setOnInsert: { createdAt: createdAt ?? now } },
      { upsert: true, returnDocument: "after" },
    );
    return saved!;
  }

  /** Atomic additive import write: no stale preview can overwrite a concurrent human edit. */
  async compareAndSet(existing: CandidateProfileDoc | null, userId: string, patch: Partial<CandidateProfileDoc>, revision: string): Promise<CandidateProfileDoc | null> {
    if (!existing) {
      try {
        const now = new Date();
        const doc = { ...patch, _id: userId, userId, createdAt: now, updatedAt: now, revision } as CandidateProfileDoc;
        await this.c.candidateProfiles.insertOne(doc);
        return doc;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return null;
        throw err;
      }
    }
    return this.c.candidateProfiles.findOneAndUpdate(
      { _id: userId, updatedAt: existing.updatedAt, ...(existing.revision ? { revision: existing.revision } : { revision: { $exists: false } }) },
      { $set: { ...patch, updatedAt: new Date(), revision } }, { returnDocument: "after" },
    );
  }
}

export class ProfileFragmentRepository {
  constructor(private readonly c: MongoCollections) {}

  async deleteByUserId(userId: string): Promise<void> {
    await this.c.profileFragments.deleteMany({ userId });
  }

  findByUserId(userId: string): Promise<ProfileFragmentDoc[]> {
    return this.c.profileFragments.find({ userId }).toArray();
  }

  findByUserIdAndSource(userId: string, source: ProfileSource): Promise<ProfileFragmentDoc | null> {
    return this.c.profileFragments.findOne({ userId, source });
  }

  async insert(doc: Omit<ProfileFragmentDoc, "_id">): Promise<void> {
    await this.c.profileFragments.insertOne({ _id: randomUUID(), ...doc });
  }

  async update(id: string, patch: Partial<Omit<ProfileFragmentDoc, "_id">>): Promise<void> {
    await this.c.profileFragments.updateOne({ _id: id }, { $set: patch });
  }

  async deleteByUserIdAndSource(userId: string, source: ProfileSource): Promise<void> {
    await this.c.profileFragments.deleteOne({ userId, source });
  }

  /** Atomic replacement of one source; never touches other providers. */
  async upsert(userId: string, source: ProfileSource, data: Record<string, unknown>, contentHash: string, fetchedAt: Date): Promise<void> {
    await this.c.profileFragments.updateOne({ userId, source },
      { $set: { data, contentHash, fetchedAt }, $inc: { version: 1 }, $setOnInsert: { _id: randomUUID(), userId, source } }, { upsert: true });
  }
}

/** Problems a candidate was given in live interviews; excluded from their later blueprints (spec §7.4). */
export class BlueprintSeenRepository {
  constructor(private readonly c: MongoCollections) {}

  async slugsFor(candidateId: string): Promise<string[]> {
    const rows = await this.c.blueprintSeen.find({ candidateId }, { projection: { slug: 1 } }).toArray();
    return [...new Set(rows.map((r) => r.slug))].sort();
  }

  /** Idempotent: a problem stays seen once, with its first session. */
  async record(candidateId: string, sessionId: string, problems: { slug: string; roundType: string }[]): Promise<void> {
    if (problems.length === 0) return;
    await this.c.blueprintSeen.bulkWrite(problems.map((p) => ({
      updateOne: {
        filter: { candidateId, slug: p.slug },
        update: { $setOnInsert: { _id: randomUUID(), candidateId, slug: p.slug, roundType: p.roundType, sessionId, at: new Date() } },
        upsert: true,
      },
    })));
  }

  async deleteByCandidate(candidateId: string): Promise<void> {
    await this.c.blueprintSeen.deleteMany({ candidateId });
  }
}

export class UserPreferencesRepository {
  constructor(private readonly c: MongoCollections) {}

  findByUserId(userId: string): Promise<UserPreferencesDoc | null> {
    return this.c.userPreferences.findOne({ _id: userId });
  }

  /** Upsert only the given dotted leaves (`"interview.pace"`), so concurrent edits of different settings never clobber each other. */
  async setPaths(userId: string, paths: Record<string, unknown>, now: Date): Promise<UserPreferencesDoc> {
    const update = { $set: { ...paths, updatedAt: now } } as UpdateFilter<UserPreferencesDoc>;
    const saved = await this.c.userPreferences.findOneAndUpdate({ _id: userId }, update, { upsert: true, returnDocument: "after" });
    return saved!;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.c.userPreferences.deleteOne({ _id: userId });
  }
}
