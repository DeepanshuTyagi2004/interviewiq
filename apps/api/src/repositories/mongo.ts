import { randomUUID } from "node:crypto";
import type {
  CandidateProfileDoc,
  MongoCollections,
  ProfileFragmentDoc,
  SessionOutcomeDoc,
} from "../db/mongo/client.js";
import type { ProfileSource } from "../domain/enums.js";

/** MongoDB repositories (native driver). */

export class CandidateProfileRepository {
  constructor(private readonly c: MongoCollections) {}

  findByUserId(userId: string): Promise<CandidateProfileDoc | null> {
    return this.c.candidateProfiles.findOne({ _id: userId });
  }

  findAll(): Promise<CandidateProfileDoc[]> {
    return this.c.candidateProfiles.find().toArray();
  }

  /** Replace the user's profile, preserving its createdAt. */
  async save(doc: Omit<CandidateProfileDoc, "_id" | "createdAt" | "updatedAt"> & { createdAt?: Date }): Promise<CandidateProfileDoc> {
    const now = new Date();
    const { createdAt, ...fields } = doc;
    const saved = await this.c.candidateProfiles.findOneAndUpdate(
      { _id: doc.userId },
      { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: createdAt ?? now } },
      { upsert: true, returnDocument: "after" },
    );
    return saved!;
  }
}

export class ProfileFragmentRepository {
  constructor(private readonly c: MongoCollections) {}

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
}

export class SessionOutcomeRepository {
  constructor(private readonly c: MongoCollections) {}

  findBySessionId(sessionId: string): Promise<SessionOutcomeDoc | null> {
    return this.c.sessionOutcomes.findOne({ _id: sessionId });
  }

  /** Idempotent: a re-delivered outcome overwrites the same document. */
  async save(sessionId: string, outcome: Record<string, unknown>): Promise<void> {
    await this.c.sessionOutcomes.replaceOne({ _id: sessionId }, { outcome, receivedAt: new Date() }, { upsert: true });
  }
}
