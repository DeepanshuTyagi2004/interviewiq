import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "flow-canvas.spec.ts",
  outputDir: path.join(os.tmpdir(), "opencode", "flow-canvas-results"),
  workers: 1,
  use: { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL, viewport: { width: 1280, height: 900 } },
});
