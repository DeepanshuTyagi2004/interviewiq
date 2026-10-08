import type { MongoCollections } from "../db/mongo/client.js";

export interface ValidationControlSettings {
  linkedinImportEnabled: boolean;
  requireSectionReview: boolean;
}

export interface ValidationControlsDoc extends ValidationControlSettings {
  _id: string;
  lastUpdatedAt: Date;
  updatedBy: string;
}

export interface ValidationControlsResponse {
  settings: ValidationControlSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const VALIDATION_CONTROLS_ID = "singleton";
export const DEFAULT_VALIDATION_CONTROLS: ValidationControlSettings = {
  linkedinImportEnabled: true,
  requireSectionReview: true,
};

const settingKeys = Object.keys(DEFAULT_VALIDATION_CONTROLS) as (keyof ValidationControlSettings)[];

function settingsFrom(doc: Partial<ValidationControlsDoc> | null): ValidationControlSettings {
  return Object.fromEntries(settingKeys.map((key) => [key, typeof doc?.[key] === "boolean" ? doc[key] : DEFAULT_VALIDATION_CONTROLS[key]])) as unknown as ValidationControlSettings;
}

export class ValidationControlsRepository {
  constructor(private readonly c: MongoCollections) {}

  async get(): Promise<ValidationControlsResponse> {
    const doc = await this.c.validationControls.findOne({ _id: VALIDATION_CONTROLS_ID });
    return { settings: settingsFrom(doc), updatedAt: doc?.lastUpdatedAt?.toISOString() ?? null, updatedBy: doc?.updatedBy ?? null };
  }

  async settings(): Promise<ValidationControlSettings> {
    return (await this.get()).settings;
  }

  async patch(patch: Partial<ValidationControlSettings>, updatedBy: string): Promise<ValidationControlsResponse> {
    const now = new Date();
    const defaults = Object.fromEntries(settingKeys.filter((key) => !(key in patch)).map((key) => [key, DEFAULT_VALIDATION_CONTROLS[key]]));
    const update = { $set: { ...patch, lastUpdatedAt: now, updatedBy }, $setOnInsert: { _id: VALIDATION_CONTROLS_ID, ...defaults } };
    let saved;
    try {
      saved = await this.c.validationControls.findOneAndUpdate({ _id: VALIDATION_CONTROLS_ID }, update, { upsert: true, returnDocument: "after" });
    } catch (err) {
      // Two first writers may race while creating the absent singleton. Retry as an update after
      // MongoDB reports the losing upsert's duplicate-key conflict.
      if ((err as { code?: number }).code !== 11000) throw err;
      saved = await this.c.validationControls.findOneAndUpdate(
        { _id: VALIDATION_CONTROLS_ID },
        { $set: { ...patch, lastUpdatedAt: now, updatedBy } },
        { returnDocument: "after" },
      );
    }
    return { settings: settingsFrom(saved), updatedAt: saved!.lastUpdatedAt.toISOString(), updatedBy: saved!.updatedBy };
  }
}
