import { randomUUID } from "node:crypto";
import type { MongoCollections } from "../db/mongo/client.js";
import type { LinkedInCareerProfile, LinkedInConfirmResponse, LinkedInImportDraft, LinkedInProvenance } from "../domain/linkedinImport.js";
import { ApiError } from "../lib/errors.js";

export interface LinkedInImportDoc {
  _id: string; userId: string; draft: LinkedInImportDraft; sourceProfile: LinkedInCareerProfile;
  provenance: LinkedInProvenance[]; expiresAt: Date;
  selection?: string[]; mergeProfile?: boolean; mergedRevision?: string;
  receipt?: LinkedInConfirmResponse;
  importedAt?: string;
  mergedProfile?: LinkedInConfirmResponse["profile"];
  confirmWarnings?: string[];
}
/** `userId` is only set on legacy Firecrawl paid-attempt receipts, which expire on their own TTL. */
export interface LinkedInImportLockDoc { _id: string; token: string; expiresAt: Date; userId?: string; state?: "dispatched" | "complete" | "failed" }

export class LinkedInImportRepository {
  constructor(private readonly c: MongoCollections) {}
  /** Short-lived opaque generation fences an in-flight PDF extraction against disconnect/deletion. */
  async epoch(userId: string): Promise<string> {
    const id = `epoch:${userId}`;
    const state = await this.c.linkedinImportLocks.findOneAndUpdate({ _id: id },
      { $setOnInsert: { token: randomUUID(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } },
      { upsert: true, returnDocument: "after" });
    return state!.token;
  }
  async matchesEpoch(userId: string, token: string): Promise<boolean> {
    return (await this.c.linkedinImportLocks.findOne({ _id: `epoch:${userId}`, token })) !== null;
  }
  async withUserLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
    const now = new Date(), token = randomUUID();
    // A Mongo lease serializes import/confirm/disconnect across API replicas, not just this process.
    await this.c.linkedinImportLocks.deleteOne({ _id: userId, expiresAt: { $lte: now } });
    try {
      await this.c.linkedinImportLocks.insertOne({ _id: userId, token, expiresAt: new Date(now.getTime() + 60_000) });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ApiError(409, "linkedin_import_busy", "Another import action is in progress. Please retry shortly.");
      throw err;
    }
    try { return await run(); }
    finally { await this.c.linkedinImportLocks.deleteOne({ _id: userId, token }); }
  }
  async checkCapacity(userId: string): Promise<void> {
    await this.c.linkedinImports.deleteMany({ userId, expiresAt: { $lte: new Date() } });
    if (await this.c.linkedinImports.countDocuments({ userId }) >= 3) {
      throw new ApiError(429, "linkedin_draft_limit", "You have three import drafts. Confirm a draft or disconnect to clear them, or wait for their 24-hour expiry.");
    }
  }
  async insert(doc: LinkedInImportDoc): Promise<void> {
    await this.checkCapacity(doc.userId);
    await this.c.linkedinImports.insertOne(doc);
  }
  find(id: string, userId: string): Promise<LinkedInImportDoc | null> { return this.c.linkedinImports.findOne({ _id: id, userId }); }
  async patch(id: string, userId: string, fields: Partial<LinkedInImportDoc>): Promise<void> {
    await this.c.linkedinImports.updateOne({ _id: id, userId }, { $set: fields });
  }
  async deleteByUserId(userId: string): Promise<void> {
    await this.c.linkedinImports.deleteMany({ userId });
    await this.c.linkedinImportLocks.deleteOne({ _id: `epoch:${userId}` });
    await this.c.linkedinImportLocks.deleteMany({ userId });
  }
  export(userId: string): Promise<LinkedInImportDoc[]> { return this.c.linkedinImports.find({ userId, expiresAt: { $gt: new Date() } }).toArray(); }
}
