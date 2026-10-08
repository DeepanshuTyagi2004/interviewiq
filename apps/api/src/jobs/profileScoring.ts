import type { ProfileScoringService } from "../services/profileScoring.js";

/** Hourly calendar poll plus startup catch-up. Durable receipts ensure one successful generation per UTC Monday week/config. */
export class ProfileScoringJob {
  constructor(private readonly service: ProfileScoringService) {}
  async runDue(): Promise<void> { await this.service.runBatch("weekly"); }
}
